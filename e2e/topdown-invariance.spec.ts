import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/en';
import { distinctColours, shoot, startPinnedDrive, type Preset } from './pinned-shoot';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
/** A drawn yard has far more; a blank or half-built pane has a handful. */
const MIN_COLOURS = 50;

test('the top-down view is the same at every graphics preset', async ({ context }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const hashes: Record<string, string[]> = { follow: [], yard: [] };
  for (const preset of PRESETS) {
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await startPinnedDrive(page, preset, en.exerciseStraightReverse);
    for (const shot of ['follow', 'yard'] as const) {
      const png = await shoot(page, shot);
      await testInfo.attach(`${preset}-${shot}.png`, { body: png, contentType: 'image/png' });
      expect(await distinctColours(page, png), `${preset} ${shot}`).toBeGreaterThan(MIN_COLOURS);
      hashes[shot]?.push(createHash('sha256').update(png).digest('hex'));
    }
    await page.close();
  }
  for (const [shot, list] of Object.entries(hashes)) {
    expect(new Set(list).size, `${shot} differs between presets`).toBe(1);
  }
  expect(errors).toEqual([]);
});
