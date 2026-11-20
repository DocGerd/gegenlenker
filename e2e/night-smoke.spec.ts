import { createHash } from 'node:crypto';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { QUALITY_FLAGS } from '../src/render/quality';
import {
  brightShare,
  DAY_BRIGHT,
  distinctColours,
  HEAVY,
  MAX_MIRROR_BRIGHT,
  MIN_DRAWN_COLOURS,
  PRESET_TIMEOUT_MS,
  type Preset,
  type Shot,
  settle,
  shoot,
  startPinnedDrive,
  tokenShare,
} from './pinned-shoot';
import { collectThreeProblems, DRIVER_PERFORMANCE_HINT } from './three-problems';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const PERSPECTIVE: readonly Shot[] = ['cockpit', 'mirrorLeft', 'mirrorRight', 'chase'];
/** Most of a perspective pane the top-down clear colour may fill: a night dome that failed would show it. */
const MAX_CLEAR_COLOUR = 0.2;

for (const preset of PRESETS) {
  test(
    `every perspective view draws at night without errors at ${preset}`,
    { tag: HEAVY },
    async ({ page }) => {
      test.setTimeout(PRESET_TIMEOUT_MS[preset]);
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text())) errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      const three = collectThreeProblems(page);
      await startPinnedDrive(page, { preset, lighting: 'night' }, en.exerciseStraightReverse);
      for (const shot of PERSPECTIVE) {
        if (shot === 'chase' && !QUALITY_FLAGS[preset].chaseView) continue;
        const png = await shoot(page, shot);
        expect(await distinctColours(page, png), `${preset} ${shot}`).toBeGreaterThan(
          MIN_DRAWN_COLOURS,
        );
        if (shot === 'mirrorLeft' || shot === 'mirrorRight') {
          expect(
            await brightShare(page, png, DAY_BRIGHT),
            `${preset} ${shot} bright pixels`,
          ).toBeLessThan(MAX_MIRROR_BRIGHT);
        }
        if (shot === 'cockpit') {
          expect(
            await tokenShare(page, png, 'nightBackdrop', 0),
            `${preset} ${shot} clear colour`,
          ).toBeLessThan(MAX_CLEAR_COLOUR);
        }
      }
      expect(errors).toEqual([]);
      expect(three).toEqual([]);
    },
  );
}

const hash = (png: Buffer): string => createHash('sha256').update(png).digest('hex');

// Lamp lenses are what the chase view shows of the lamps; the light they cast is not asserted here.
test(
  'the lamp keys and buttons switch the lenses at night at balanced',
  { tag: HEAVY },
  async ({ page }) => {
    test.setTimeout(PRESET_TIMEOUT_MS.balanced);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text())) errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const three = collectThreeProblems(page);
    await startPinnedDrive(
      page,
      { preset: 'balanced', lighting: 'night' },
      en.exerciseStraightReverse,
    );
    const lights = page.locator('[data-ctl="lights"]');
    const hazard = page.locator('[data-ctl="hazard"]');
    await expect(lights).toHaveAttribute('aria-pressed', 'true');
    await expect(hazard).toHaveAttribute('aria-pressed', 'false');
    const lit = hash(await shoot(page, 'chase'));

    await page.keyboard.press('h');
    await settle(page, 'balanced');
    await expect(lights).toHaveAttribute('aria-pressed', 'false');
    const dark = hash(await shoot(page, 'chase'));
    expect(dark, 'lights off').not.toBe(lit);

    await lights.click();
    await settle(page, 'balanced');
    await expect(lights).toHaveAttribute('aria-pressed', 'true');
    expect(hash(await shoot(page, 'chase')), 'lights back on').toBe(lit);

    await hazard.click();
    await page.keyboard.press('x');
    await settle(page, 'balanced');
    await expect(hazard).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
    expect(three).toEqual([]);
  },
);
