import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { distinctColours, MIN_DRAWN_COLOURS, shoot, startPinnedDrive } from './pinned-shoot';
import { collectThreeProblems } from './three-problems';

// Night has no look of its own yet, so this only guards that the stored mode draws without errors.
test('the cockpit draws at night without errors', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const three = collectThreeProblems(page);
  await startPinnedDrive(page, { preset: 'high', lighting: 'night' }, en.exerciseStraightReverse);
  const png = await shoot(page, 'cockpit');
  expect(await distinctColours(page, png)).toBeGreaterThan(MIN_DRAWN_COLOURS);
  expect(errors).toEqual([]);
  expect(three).toEqual([]);
});
