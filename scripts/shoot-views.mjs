// Pinned-clock shots of every view per graphics preset, for before/after renderer comparisons.
// Usage: node scripts/shoot-views.mjs --url <app url> --out <dir> [--backend webgl2|webgpu]
//          [--compare <hashes.json>] [--diff <dir>] [--lighting day|night] [--gear R]
//          [--new-headless]
//        node scripts/shoot-views.mjs --out <dir> --diff <dir>   (diff earlier shots only)
// --backend webgpu draws on SwiftShader's WebGPU adapter (no GPU needed) in Chromium's new headless
// mode. That mode wraps HUD text differently, which moves the top-down framing, so shoot the WebGL 2
// side of a WebGPU diff with --new-headless.
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
  shiftToReverse,
  shoot,
  startPinnedDrive,
  tokenShare,
} from '../e2e/pinned-shoot.ts';
import { collectThreeProblems } from '../e2e/three-problems.ts';
import { QUALITY_FLAGS } from '../src/render/quality.ts';

const PRESETS = ['low', 'balanced', 'high'];
const SHOTS = ['cockpit', 'mirrorLeft', 'mirrorRight', 'front', 'follow', 'yard', 'chase'];
/** Views whose flat regions must survive a renderer change; the perspective ones are judged by eye. */
const TOP_DOWN = new Set(['follow', 'yard']);
/** Largest step a flat pixel may move: an 8-bit linear intermediate rounds sRGB tokens, dark ones by more. */
const MAX_FLAT_DELTA = 2;
/** Share of flat pixels allowed to move by more than one step (the dark tokens). */
const MAX_FLAT_MORE = 0.015;
/** Share of edge pixels allowed to move by more than one step: antialiasing differs between renderers. */
const MAX_EDGE_MORE = 0.55;
/** Most of a cockpit shot the clear colour may fill: the mirrors alone carry a wiped pane past the colour count. */
const MAX_COCKPIT_BACKDROP = 0.2;
const EXERCISE = 'Straight reverse';
// Same GL as the e2e `offline` project, so hashes match what CI renders.
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
// Only the new headless mode presents SwiftShader WebGPU frames; other flag sets lose the device.
const WEBGPU = {
  channel: 'chromium',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ],
};

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string' },
    compare: { type: 'string' },
    diff: { type: 'string' },
    backend: { type: 'string', default: 'webgl2' },
    lighting: { type: 'string', default: 'day' },
    gear: { type: 'string' },
    'new-headless': { type: 'boolean', default: false },
  },
});
if (values.backend !== 'webgl2' && values.backend !== 'webgpu') {
  console.error('--backend must be webgl2 or webgpu');
  process.exit(2);
}
if (values.lighting !== 'day' && values.lighting !== 'night') {
  console.error('--lighting must be day or night');
  process.exit(2);
}
if (values.gear !== undefined && values.gear !== 'R') {
  console.error('--gear must be R');
  process.exit(2);
}
if (values.out === undefined || (values.url === undefined && values.diff === undefined)) {
  console.error(
    'usage: node scripts/shoot-views.mjs --url <url> --out <dir> [--compare <json>] [--diff <dir>]',
  );
  process.exit(2);
}
mkdirSync(values.out, { recursive: true });

const browser = await chromium.launch(
  values.backend === 'webgpu' || values['new-headless'] ? WEBGPU : { args: ARGS },
);
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
      const problems = collectThreeProblems(page);
      page.on('pageerror', (e) => problems.push(e.message));
      await startPinnedDrive(
        page,
        { preset, lighting: values.lighting },
        EXERCISE,
        `?backend=${values.backend}`,
      );
      if (values.gear === 'R') await shiftToReverse(page);
      const backend = await page.locator('html').getAttribute('data-render-backend');
      if (backend !== values.backend)
        throw new Error(`${preset}: drawn on ${backend ?? 'nothing'}, not ${values.backend}`);
      const chase = await page.locator('[data-view="chase"]').isVisible();
      if (chase !== QUALITY_FLAGS[preset].chaseView)
        throw new Error(`${preset}: chase view ${chase ? 'shown' : 'hidden'} against its flag`);
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
        if (shot === 'cockpit') {
          const backdrop = await tokenShare(
            page,
            png,
            values.lighting === 'night' ? 'nightBackdrop' : 'backdrop',
            0,
          );
          if (backdrop > MAX_COCKPIT_BACKDROP)
            throw new Error(
              `${name} is ${(100 * backdrop).toFixed(0)}% clear colour: pane not drawn`,
            );
        }
        writeFileSync(join(values.out, `${name}.png`), png);
        hashes[name] = createHash('sha256').update(png).digest('hex');
      }
      if (problems.length > 0) throw new Error(`${preset}: ${problems.join('; ')}`);
      await context.close();
    }
    writeFileSync(join(values.out, 'hashes.json'), `${JSON.stringify(hashes, null, 2)}\n`);
    // after a gear change the follow framing is still easing towards its lead, at a pace each preset's frames set
    for (const shot of values.gear === undefined ? TOP_DOWN : []) {
      const seen = new Set(PRESETS.map((preset) => hashes[`${preset}-${shot}`]));
      if (seen.size !== 1) {
        console.log(`FAIL   ${shot}: the top-down view differs between presets`);
        failed++;
      }
    }
  }

  if (values.diff !== undefined) {
    const page = await browser.newPage();
    const heatmaps = join(values.out, 'diff');
    mkdirSync(heatmaps, { recursive: true });
    const names = readdirSync(values.out).filter((f) => f.endsWith('.png'));
    let compared = 0;
    for (const file of names.sort()) {
      const name = file.slice(0, -'.png'.length);
      const beforeFile = join(values.diff, file);
      if (!existsSync(beforeFile)) {
        console.log(`new    ${name}`);
        continue;
      }
      const before = readFileSync(beforeFile);
      const after = readFileSync(join(values.out, file));
      const drawn = [await distinctColours(page, before), await distinctColours(page, after)];
      if (drawn.some((colours) => colours <= MIN_DRAWN_COLOURS)) {
        console.log(`BLANK  ${name}: ${drawn.join(' / ')} colours before / after`);
        failed++;
        continue;
      }
      const r = await diffShot(page, before, after);
      if (r === null) {
        console.log(`SIZE   ${name}`);
        failed++;
        continue;
      }
      compared++;
      writeFileSync(join(heatmaps, file), r.heatmap);
      const topDown = TOP_DOWN.has(name.split('-')[1]);
      const edges = r.pixels - r.flat;
      const ok =
        r.flat > 0 &&
        r.maxFlat <= MAX_FLAT_DELTA &&
        r.flatMore <= MAX_FLAT_MORE * r.flat &&
        r.edgeMore <= MAX_EDGE_MORE * edges;
      const verdict = !topDown ? 'look  ' : ok ? 'pass  ' : 'FAIL  ';
      if (topDown && !ok) failed++;
      const pct = (n, of) => `${((100 * n) / of).toFixed(2)}%`;
      console.log(
        `${verdict} ${name}: flat ${pct(r.flat, r.pixels)} of px, identical ${pct(r.flatSame, r.flat)}, ` +
          `±1 ${r.flatOne}, >1 ${r.flatMore} (max ${r.maxFlat}); edge px >1: ${r.edgeMore} (${pct(r.edgeMore, edges)})`,
      );
    }
    if (compared === 0) {
      console.log(`no shot of ${values.out} has a counterpart in ${values.diff}`);
      failed++;
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
process.exit(failed === 0 && (values.diff !== undefined || differ === 0) ? 0 : 1);
