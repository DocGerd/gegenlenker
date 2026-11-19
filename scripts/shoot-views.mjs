// Pinned-clock shots of every view per graphics preset, for before/after renderer comparisons.
// Usage: node scripts/shoot-views.mjs --url <app url> --out <dir> [--compare <hashes.json>]
// Serve a build with BASE_PATH=/gegenlenker/ on a port other than the e2e one.
import console from 'node:console';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { distinctColours, shoot, startPinnedDrive } from '../e2e/pinned-shoot.ts';

const PRESETS = ['low', 'balanced', 'high'];
const SHOTS = ['cockpit', 'mirrorLeft', 'mirrorRight', 'follow', 'yard', 'chase'];
const EXERCISE = 'Straight reverse';
// A drawn pane has far more; a blank pane or a notice has a handful.
const MIN_COLOURS = 50;
// Same GL as the e2e `offline` project, so hashes match what CI renders.
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];

const { values } = parseArgs({
  options: { url: { type: 'string' }, out: { type: 'string' }, compare: { type: 'string' } },
});
if (values.url === undefined || values.out === undefined) {
  console.error('usage: node scripts/shoot-views.mjs --url <url> --out <dir> [--compare <json>]');
  process.exit(2);
}
mkdirSync(values.out, { recursive: true });

const browser = await chromium.launch({ args: ARGS });
const hashes = {};
try {
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
      if (colours < MIN_COLOURS) throw new Error(`${name} has ${colours} colours: not drawn`);
      writeFileSync(join(values.out, `${name}.png`), png);
      hashes[name] = createHash('sha256').update(png).digest('hex');
    }
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(values.out, 'hashes.json'), `${JSON.stringify(hashes, null, 2)}\n`);

let differ = 0;
if (values.compare !== undefined) {
  const before = JSON.parse(readFileSync(values.compare, 'utf8'));
  for (const name of new Set([...Object.keys(before), ...Object.keys(hashes)])) {
    const same = before[name] === hashes[name];
    if (!same) differ++;
    console.log(`${same ? 'same  ' : 'DIFFER'} ${name}`);
  }
} else {
  for (const [name, hash] of Object.entries(hashes)) console.log(`${hash.slice(0, 16)} ${name}`);
}
process.exit(differ === 0 ? 0 : 1);
