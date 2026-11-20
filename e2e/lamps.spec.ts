import { createHash } from 'node:crypto';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { type Preset, settle, shoot, startPinnedDrive } from './pinned-shoot';
import { collectThreeProblems } from './three-problems';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const hash = (png: Buffer): string => createHash('sha256').update(png).digest('hex');

// The stop lamps light by day; lamp lenses are perspective-only. Reverse would also move the
// prediction aid, so the brake alone switches a lamp here. No camera sees the stop lamps, so
// src/render/lamp-lens.test.ts checks that they light.
test('lighting the stop lamps leaves the top-down view unchanged at every preset', async ({
  context,
}) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  const threeProblems: string[] = [];
  for (const preset of PRESETS) {
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const three = collectThreeProblems(page);
    await startPinnedDrive(page, preset, en.exerciseStraightReverse);
    if (preset !== 'low') {
      await expect(page.locator('html')).toHaveAttribute('data-vehicle-shells', /^\S+ \S+ \S+$/);
    }
    const before = [hash(await shoot(page, 'follow')), hash(await shoot(page, 'yard'))];
    await page.keyboard.down('Space');
    await settle(page, preset);
    await expect(page.locator('[data-ctl="stop"]')).toHaveAttribute('data-active', '');
    const after = [hash(await shoot(page, 'follow')), hash(await shoot(page, 'yard'))];
    await page.keyboard.up('Space');
    expect(after, preset).toEqual(before);
    threeProblems.push(...three);
    await page.close();
  }
  expect(errors).toEqual([]);
  expect(threeProblems).toEqual([]);
});
