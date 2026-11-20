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
