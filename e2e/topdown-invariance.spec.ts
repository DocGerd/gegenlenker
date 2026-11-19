import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/en';
import {
  distinctColours,
  MIN_DRAWN_COLOURS,
  shoot,
  startPinnedDrive,
  type Preset,
} from './pinned-shoot';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];

// DPR 1 only: the preset's pixel-ratio cap changes resolution, a performance knob, not what is drawn.
test('the top-down view is the same at every graphics preset', async ({ context }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  // One exercise per yard, so each yard's restyled props are covered.
  for (const exercise of [en.exerciseStraightReverse, en.exerciseReverseBay]) {
    const hashes: Record<string, string[]> = { follow: [], yard: [] };
    for (const preset of PRESETS) {
      const page = await context.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await startPinnedDrive(page, preset, exercise);
      for (const shot of ['follow', 'yard'] as const) {
        const png = await shoot(page, shot);
        const name = `${exercise} ${preset} ${shot}`;
        await testInfo.attach(`${name}.png`, { body: png, contentType: 'image/png' });
        expect(await distinctColours(page, png), name).toBeGreaterThan(MIN_DRAWN_COLOURS);
        hashes[shot]?.push(createHash('sha256').update(png).digest('hex'));
      }
      await page.close();
    }
    for (const [shot, list] of Object.entries(hashes)) {
      expect(new Set(list).size, `${exercise} ${shot} differs between presets`).toBe(1);
    }
  }
  expect(errors).toEqual([]);
});
