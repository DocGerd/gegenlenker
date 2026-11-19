import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/en';
import {
  distinctColours,
  MIN_DRAWN_COLOURS,
  shoot,
  startPinnedDrive,
  tokenShare,
  type Preset,
  type Shot,
} from './pinned-shoot';
import { collectThreeProblems } from './three-problems';
import type { ScenePaletteKey } from '../src/contracts/render';

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
/** Share of the pane a token's flat region must fill, so a stray pixel cannot pass. */
const MIN_TOKEN_SHARE = 0.003;
/** The tokens each shot draws as large flat regions. */
const TOKENS: Readonly<Partial<Record<Shot, readonly ScenePaletteKey[]>>> = {
  follow: ['yard', 'body'],
  yard: ['backdrop', 'yard', 'street', 'verge'],
};

// DPR 1 only: the preset's pixel-ratio cap changes resolution, a performance knob, not what is drawn.
test('the top-down view is the same at every graphics preset', async ({ context }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const threeProblems: string[] = [];
  // One exercise per yard, so each yard's restyled props are covered.
  for (const exercise of [en.exerciseStraightReverse, en.exerciseReverseBay]) {
    const hashes: Record<string, string[]> = { follow: [], yard: [] };
    for (const preset of PRESETS) {
      const page = await context.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      const three = collectThreeProblems(page);
      await startPinnedDrive(page, preset, exercise);
      for (const shot of ['follow', 'yard'] as const) {
        const png = await shoot(page, shot);
        const name = `${exercise} ${preset} ${shot}`;
        await testInfo.attach(`${name}.png`, { body: png, contentType: 'image/png' });
        expect(await distinctColours(page, png), name).toBeGreaterThan(MIN_DRAWN_COLOURS);
        for (const token of TOKENS[shot] ?? []) {
          const share = await tokenShare(page, png, token, TOKEN_TOLERANCE[token] ?? 0);
          expect(share, `${name}: ${token}`).toBeGreaterThan(MIN_TOKEN_SHARE);
        }
        hashes[shot]?.push(createHash('sha256').update(png).digest('hex'));
      }
      threeProblems.push(...three);
      await page.close();
    }
    for (const [shot, list] of Object.entries(hashes)) {
      expect(new Set(list).size, `${exercise} ${shot} differs between presets`).toBe(1);
    }
  }
  expect(errors).toEqual([]);
  expect(threeProblems).toEqual([]);
});
