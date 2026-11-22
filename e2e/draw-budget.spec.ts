import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { DRAW_CALL_BUDGET, QUALITY_FLAGS } from '../src/render/quality';
import { drawnBackend, parseOverlay } from './perf/tablet-logic';
import type { LightingMode } from '../src/contracts/render';
import { type Preset, settle, slowAt, startPinnedDrive, timeoutWithSettles } from './pinned-shoot';

// High at night is the one lit scene with the sun's shadow pass taken out, the aids unlit and the lamps' passes in.
const RUNS: readonly { preset: Preset; lighting: LightingMode }[] = [
  { preset: 'low', lighting: 'day' },
  { preset: 'balanced', lighting: 'day' },
  { preset: 'high', lighting: 'day' },
  { preset: 'high', lighting: 'night' },
];
const VIEWS = [
  { view: 'follow', key: 'f' },
  { view: 'yard', key: 'y' },
  { view: 'chase', key: 'o' },
] as const;
/** Longer than the overlay's refresh interval, with frames in between. */
const PAST_REFRESH_MS = 500;
/** The sun at High by day; at night the dipped beam and the trailer's rear light, both lit at the start. */
const SHADOW_PASSES = { day: 1, night: 2 } as const;

for (const { preset, lighting } of RUNS) {
  const label = lighting === 'night' ? `${preset} at night` : preset;
  for (const { view, key } of VIEWS) {
    if (view === 'chase' && !QUALITY_FLAGS[preset].chaseView) continue;
    test(
      `the ${view} view stays within the draw-call budget at ${label}`,
      slowAt(preset),
      async ({ context }) => {
        test.setTimeout(timeoutWithSettles(preset, 2));
        const page = await context.newPage();
        // every mirror draws at this size: budget the worst case
        await page.setViewportSize({ width: 1920, height: 1080 });
        await startPinnedDrive(page, { preset, lighting }, en.exerciseStraightReverse, '?perf=1');
        await page.keyboard.press(key);
        await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed', 'true');
        await settle(page, preset);
        await page.clock.runFor(PAST_REFRESH_MS);
        const text = await page.locator('div.mono', { hasText: /calls \d+/ }).textContent();
        const reading = parseOverlay(text ?? '');
        if (reading === null) throw new Error(`${label} ${view}: no overlay reading`);
        expect(drawnBackend(reading.gl), `${label} ${view} backend`).toBe('webgl2');
        expect(reading.calls, `${label} ${view} drew nothing`).toBeGreaterThan(0);
        expect(reading.shadow, `${label} ${view} shadow passes`).toBe(
          preset === 'high' ? SHADOW_PASSES[lighting] : 0,
        );
        expect(reading.calls, `draw calls over ${DRAW_CALL_BUDGET}`).toBeLessThanOrEqual(
          DRAW_CALL_BUDGET,
        );
      },
    );
  }
}
