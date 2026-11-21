import { createHash } from 'node:crypto';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import {
  heavyAt,
  timeoutWithSettles,
  type Preset,
  settle,
  shoot,
  startPinnedDrive,
} from './pinned-shoot';
import { collectThreeProblems, DRIVER_PERFORMANCE_HINT } from './three-problems';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const hash = (png: Buffer): string => createHash('sha256').update(png).digest('hex');

// The stop lamps light by day; lamp lenses are perspective-only. Reverse would also move the
// prediction aid, so the brake alone switches a lamp here. No camera sees the stop lamps, so
// src/render/lamp-lens.test.ts checks that they light.
for (const preset of PRESETS) {
  test(
    `lighting the stop lamps leaves the top-down view unchanged at ${preset}`,
    heavyAt(preset),
    async ({ context }) => {
      test.setTimeout(timeoutWithSettles(preset, 2));
      const errors: string[] = [];
      const page = await context.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text())) errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      const threeProblems = collectThreeProblems(page);
      await startPinnedDrive(page, { preset, lighting: 'day' }, en.exerciseStraightReverse);
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
      expect(errors).toEqual([]);
      expect(threeProblems).toEqual([]);
    },
  );
}
