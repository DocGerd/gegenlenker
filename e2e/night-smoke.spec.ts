import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { QUALITY_FLAGS } from '../src/render/quality';
import {
  brightShare,
  DAY_BRIGHT,
  distinctColours,
  heavyAt,
  MAX_MIRROR_BRIGHT,
  MIN_DRAWN_COLOURS,
  PRESET_TIMEOUT_MS,
  type Preset,
  brightenedShare,
  type Shot,
  shiftToReverse,
  shoot,
  startPinnedDrive,
  tokenShare,
} from './pinned-shoot';
import { collectThreeProblems, DRIVER_PERFORMANCE_HINT } from './three-problems';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const PERSPECTIVE: readonly Shot[] = ['cockpit', 'mirrorLeft', 'mirrorRight', 'chase'];
/** Most of a perspective pane the top-down clear colour may fill: a night dome that failed would show it. */
const MAX_CLEAR_COLOUR = 0.2;
/** Levels (0-255) a mirror pixel must brighten by to count as lit by the reversing lamps. */
const LAMP_STEP = 4;
/** Least share of a mirror the reversing lamps must light: a pool the driver can use, not a sliver beside the trailer. */
const MIN_REVERSING_POOL = 0.01;

for (const preset of PRESETS) {
  test(
    `every perspective view draws at night without errors at ${preset}`,
    heavyAt(preset),
    async ({ page }) => {
      test.setTimeout(PRESET_TIMEOUT_MS[preset]);
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text())) errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      const three = collectThreeProblems(page);
      await startPinnedDrive(page, { preset, lighting: 'night' }, en.exerciseStraightReverse);
      const parked: Partial<Record<Shot, Buffer>> = {};
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
          parked[shot] = png;
        }
        if (shot === 'cockpit') {
          expect(
            await tokenShare(page, png, 'nightBackdrop', 0),
            `${preset} ${shot} clear colour`,
          ).toBeLessThan(MAX_CLEAR_COLOUR);
        }
      }
      if (QUALITY_FLAGS[preset].lampLight) {
        // the reversing lamps light the ground behind truck and trailer, which the mirrors show
        await shiftToReverse(page);
        for (const shot of ['mirrorLeft', 'mirrorRight'] as const) {
          const before = parked[shot];
          if (before === undefined) throw new Error(`no ${shot} shot in P`);
          const share = await brightenedShare(page, before, await shoot(page, shot), LAMP_STEP);
          expect(share, `${preset} ${shot} in R`).toBeGreaterThan(MIN_REVERSING_POOL);
        }
      }
      expect(errors).toEqual([]);
      expect(three).toEqual([]);
    },
  );
}
