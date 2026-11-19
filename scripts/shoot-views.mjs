// Pinned-clock shots of every view per graphics preset, for before/after renderer comparisons.
// Usage: node scripts/shoot-views.mjs --url <app url> --out <dir> [--compare <hashes.json>] [--diff <dir>]
//        node scripts/shoot-views.mjs --out <dir> --diff <dir>   (diff earlier shots only)
// Serve a build with BASE_PATH=/gegenlenker/ on a port other than the e2e one.
// --diff compares each PNG in --out with its namesake in <dir> (the before shots); see diffShot.
import console from 'node:console';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import {
  diffShot,
  distinctColours,
  MIN_DRAWN_COLOURS,
  shoot,
  startPinnedDrive,
} from '../e2e/pinned-shoot.ts';

const PRESETS = ['low', 'balanced', 'high'];
const SHOTS = ['cockpit', 'mirrorLeft', 'mirrorRight', 'follow', 'yard', 'chase'];
/** Views whose flat regions must survive a renderer change; the perspective ones are judged by eye. */
const TOP_DOWN = new Set(['follow', 'yard']);
/** Share of flat pixels allowed to move by one step (rounding of the same colour). */
const MAX_FLAT_OFF_BY_ONE = 0.005;
const EXERCISE = 'Straight reverse';
// Same GL as the e2e `offline` project, so hashes match what CI renders.
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string' },
    compare: { type: 'string' },
    diff: { type: 'string' },
  },
});
if (values.out === undefined || (values.url === undefined && values.diff === undefined)) {
  console.error(
    'usage: node scripts/shoot-views.mjs --url <url> --out <dir> [--compare <json>] [--diff <dir>]',
  );
  process.exit(2);
}
mkdirSync(values.out, { recursive: true });

const browser = await chromium.launch({ args: ARGS });
const hashes = {};
let failed = 0;
try {
  if (values.url !== undefined) {
    for (const preset of PRESETS) {
      const context = await browser.newContext({
        baseURL: values.url,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        locale: 'en-US',
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      await startPinnedDrive(page, preset, EXERCISE);
      const chase = await page.locator('[data-view="chase"]').isVisible();
      for (const shot of SHOTS) {
        const name = `${preset}-${shot}`;
        if (shot === 'chase' && !chase) {
          console.log(`skip   ${name}: no chase view at this preset`);
          continue;
        }
        const png = await shoot(page, shot);
        const colours = await distinctColours(page, png);
        if (colours <= MIN_DRAWN_COLOURS)
          throw new Error(`${name} has ${colours} colours: not drawn`);
        writeFileSync(join(values.out, `${name}.png`), png);
        hashes[name] = createHash('sha256').update(png).digest('hex');
      }
      await context.close();
    }
    writeFileSync(join(values.out, 'hashes.json'), `${JSON.stringify(hashes, null, 2)}\n`);
  }

  if (values.diff !== undefined) {
    const page = await browser.newPage();
    const heatmaps = join(values.out, 'diff');
    mkdirSync(heatmaps, { recursive: true });
    const names = readdirSync(values.out).filter((f) => f.endsWith('.png'));
    for (const file of names.sort()) {
      const name = file.slice(0, -'.png'.length);
      const beforeFile = join(values.diff, file);
      if (!existsSync(beforeFile)) {
        console.log(`new    ${name}`);
        continue;
      }
      const r = await diffShot(
        page,
        readFileSync(beforeFile),
        readFileSync(join(values.out, file)),
      );
      if (r === null) {
        console.log(`SIZE   ${name}`);
        failed++;
        continue;
      }
      writeFileSync(join(heatmaps, file), r.heatmap);
      const topDown = TOP_DOWN.has(name.split('-')[1]);
      const ok = r.flatMore === 0 && r.flatOne <= MAX_FLAT_OFF_BY_ONE * r.flat && r.maxFlat <= 1;
      const verdict = !topDown ? 'look  ' : ok ? 'pass  ' : 'FAIL  ';
      if (topDown && !ok) failed++;
      const pct = (n, of) => `${((100 * n) / of).toFixed(2)}%`;
      console.log(
        `${verdict} ${name}: flat ${pct(r.flat, r.pixels)} of px, identical ${pct(r.flatSame, r.flat)}, ` +
          `±1 ${r.flatOne}, >1 ${r.flatMore} (max ${r.maxFlat}); edge px >1: ${r.edgeMore}`,
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
}

let differ = 0;
if (values.url !== undefined && values.compare !== undefined) {
  const before = JSON.parse(readFileSync(values.compare, 'utf8'));
  for (const name of new Set([...Object.keys(before), ...Object.keys(hashes)])) {
    const same = before[name] === hashes[name];
    if (!same) differ++;
    console.log(`${same ? 'same  ' : 'DIFFER'} ${name}`);
  }
} else if (values.url !== undefined && values.diff === undefined) {
  for (const [name, hash] of Object.entries(hashes)) console.log(`${hash.slice(0, 16)} ${name}`);
}
// with --diff, only a top-down failure fails the run: the renderer change is expected to move hashes
process.exit(values.diff !== undefined ? (failed === 0 ? 0 : 1) : differ === 0 ? 0 : 1);
