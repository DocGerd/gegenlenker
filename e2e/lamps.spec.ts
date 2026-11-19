import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/en';
import { type Preset, settle, shoot, startPinnedDrive } from './pinned-shoot';
import { collectThreeProblems } from './three-problems';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const hash = (png: Buffer): string => createHash('sha256').update(png).digest('hex');

// The stop lamps light by day; lamp lenses are perspective-only. Reverse would also move the
// prediction aid, so the brake alone switches a lamp here.
test('lighting the stop lamps leaves the top-down view unchanged at every preset', async ({
  context,
}) => {
  test.setTimeout(240_000);
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
    const before = [hash(await shoot(page, 'follow')), hash(await shoot(page, 'yard'))];
    await page.keyboard.down('Space');
    await settle(page, preset);
    const after = [hash(await shoot(page, 'follow')), hash(await shoot(page, 'yard'))];
    await page.keyboard.up('Space');
    expect(after, preset).toEqual(before);
    threeProblems.push(...three);
    await page.close();
  }
  expect(errors).toEqual([]);
  expect(threeProblems).toEqual([]);
});
