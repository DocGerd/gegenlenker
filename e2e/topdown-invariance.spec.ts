import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/en';
import {
  diffShot,
  distinctColours,
  renderScale,
  MIN_DRAWN_COLOURS,
  shoot,
  startPinnedDrive,
  tokenShare,
  type Preset,
} from './pinned-shoot';
import { collectThreeProblems } from './three-problems';
import type { ScenePaletteKey } from '../src/contracts/render';

const sha = (png: Buffer): string => createHash('sha256').update(png).digest('hex');
const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];

/**
 * Per channel, how far a flat region may sit from its `--scene-*` token. The clear colour is unlit and
 * comes out exact; ground, road, verge and the vehicle body are lit, so they carry the sun and hemisphere shade (the
 * previous renderer shows the same), plus the 8-bit linear intermediate's rounding.
 */
const TOKEN_TOLERANCE: Readonly<Partial<Record<ScenePaletteKey, number>>> = {
  backdrop: 0,
  yard: 8,
  street: 5,
  verge: 6,
  body: 7,
};
/**
 * Share of the pane each shot's token must fill, set per shot and token so a change that moves most
 * of the pane off its tokens fails even while a small region still matches.
 */
const MIN_TOKEN_SHARE: Readonly<
  Record<'follow' | 'yard', readonly (readonly [ScenePaletteKey, number])[]>
> = {
  follow: [
    ['yard', 0.5],
    ['body', 0.005],
  ],
  yard: [
    ['backdrop', 0.5],
    ['yard', 0.04],
    ['street', 0.008],
    ['verge', 0.1],
  ],
};

// DPR 1 only: the preset's pixel-ratio cap changes resolution, a performance knob, not what is drawn.
test('the top-down view is the same at every graphics preset', async ({ context }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const threeProblems: string[] = [];
  const mismatches: string[] = [];
  const scales: { label: string; scale: number }[] = [];
  // One exercise per yard, so each yard's restyled props are covered.
  for (const exercise of [en.exerciseStraightReverse, en.exerciseReverseBay]) {
    const shots = { follow: new Map<Preset, Buffer>(), yard: new Map<Preset, Buffer>() };
    for (const preset of PRESETS) {
      const page = await context.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      const three = collectThreeProblems(page);
      await startPinnedDrive(page, preset, exercise);
      scales.push({ label: `${exercise} ${preset} before`, scale: await renderScale(page) });
      for (const shot of ['follow', 'yard'] as const) {
        const png = await shoot(page, shot);
        const name = `${exercise} ${preset} ${shot}`;
        await testInfo.attach(`${name}.png`, { body: png, contentType: 'image/png' });
        expect(await distinctColours(page, png), name).toBeGreaterThan(MIN_DRAWN_COLOURS);
        for (const [token, min] of MIN_TOKEN_SHARE[shot]) {
          const share = await tokenShare(page, png, token, TOKEN_TOLERANCE[token] ?? 0);
          expect(share, `${name}: ${token}`).toBeGreaterThan(min);
        }
        shots[shot].set(preset, png);
      }
      scales.push({ label: `${exercise} ${preset} after`, scale: await renderScale(page) });
      threeProblems.push(...three);
      await page.close();
    }
    const scratch = await context.newPage();
    for (const [shot, byPreset] of Object.entries(shots)) {
      const [first, ...rest] = PRESETS;
      const base = first === undefined ? undefined : byPreset.get(first);
      if (first === undefined || base === undefined) throw new Error(`no ${shot} shot`);
      for (const preset of rest) {
        const png = byPreset.get(preset);
        if (png === undefined) throw new Error(`no ${shot} shot at ${preset}`);
        if (sha(png) === sha(base)) continue;
        const pair = `${exercise} ${shot}: ${first} vs ${preset}`;
        const diff = await diffShot(scratch, base, png);
        if (diff === null) {
          mismatches.push(`${pair} differ in size`);
          continue;
        }
        const { heatmap, ...counts } = diff;
        await testInfo.attach(`${pair} diff.png`, { body: heatmap, contentType: 'image/png' });
        mismatches.push(`${pair} ${JSON.stringify(counts)}`);
      }
    }
    await scratch.close();
  }
  const scaleLines = scales.map((e) => `${e.label} ${e.scale}`);
  await testInfo.attach('render scales', {
    body: scaleLines.join('\n'),
    contentType: 'text/plain',
  });
  expect(new Set(scales.map((e) => e.scale)).size, scaleLines.join('; ')).toBe(1);
  expect(mismatches, 'top-down shots differ between presets').toEqual([]);
  expect(errors).toEqual([]);
  expect(threeProblems).toEqual([]);
});
