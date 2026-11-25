import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { DRAW_CALL_BUDGET, QUALITY_FLAGS } from '../src/render/quality';
import { drawnBackend, parseOverlay } from './perf/tablet-logic';
import type { LightingMode } from '../src/contracts/render';
import {
  type Preset,
  settle,
  slowAt,
  startPinnedDrive,
  step,
  timeoutWithSettles,
} from './pinned-shoot';

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
/** The sun at High by day; at night the two dipped lamps and the trailer's rear light, all lit at the start. */
const SHADOW_PASSES = { day: 1, night: 3 } as const;

type Run = { preset: Preset; lighting: LightingMode };

/** The overlay's draw calls once the frames after a change have been drawn; `what` names the view in failures. */
async function drawnCalls(page: Page, { preset, lighting }: Run, what: string): Promise<number> {
  const label = lighting === 'night' ? `${preset} at night` : preset;
  await settle(page, preset);
  await page.clock.runFor(PAST_REFRESH_MS);
  const text = await page.locator('div.mono', { hasText: /calls \d+/ }).textContent();
  const reading = parseOverlay(text ?? '');
  if (reading === null) throw new Error(`${label} ${what}: no overlay reading`);
  expect(drawnBackend(reading.gl), `${label} ${what} backend`).toBe('webgl2');
  expect(reading.calls, `${label} ${what} drew nothing`).toBeGreaterThan(0);
  expect(reading.shadow, `${label} ${what} shadow passes`).toBe(
    preset === 'high' ? SHADOW_PASSES[lighting] : 0,
  );
  return reading.calls;
}

async function startAtFullSize(page: Page, { preset, lighting }: Run): Promise<void> {
  // every mirror draws at this size: budget the worst case
  await page.setViewportSize({ width: 1920, height: 1080 });
  await startPinnedDrive(page, { preset, lighting }, en.exerciseStraightReverse, '?perf=1');
}

/** One pointer drag from the pane's centre, `dy` px down, as the free camera reads it. */
async function dragPane(page: Page, dy: number): Promise<void> {
  const box = await page.locator('[data-hud="topDown"]').boundingBox();
  if (box === null) throw new Error('no top-down pane');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 4 });
  await page.mouse.up();
}

for (const run of RUNS) {
  const { preset, lighting } = run;
  const label = lighting === 'night' ? `${preset} at night` : preset;
  for (const { view, key } of VIEWS) {
    if (view === 'chase' && !QUALITY_FLAGS[preset].chaseView) continue;
    test(
      `the ${view} view stays within the draw-call budget at ${label}`,
      slowAt(preset),
      async ({ context }) => {
        test.setTimeout(timeoutWithSettles(preset, 2));
        const page = await context.newPage();
        await startAtFullSize(page, run);
        await page.keyboard.press(key);
        await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed', 'true');
        const calls = await drawnCalls(page, run, view);
        expect(calls, `draw calls over ${DRAW_CALL_BUDGET}`).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
      },
    );
  }

  // High only: the free camera sees the most from the greatest height, and the lower presets draw less of it
  if (preset === 'high') {
    test(
      `the free camera stays within the draw-call budget at ${label}, from the greatest height and from a low look at the skyline`,
      slowAt(preset),
      async ({ context }) => {
        test.setTimeout(timeoutWithSettles(preset, 3));
        const page = await context.newPage();
        await startAtFullSize(page, run);
        await page.keyboard.press('k');
        // the pinned clock holds the frame that starts the flight
        await step(page, 3);
        await expect(page.locator('[data-hud="freeCamera"]')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        // look down, then fly back along the gaze: up to the greatest height
        await dragPane(page, -900);
        await dragPane(page, -900);
        await page.mouse.wheel(0, 1000);
        await page.mouse.wheel(0, 1000);
        const high = await drawnCalls(page, run, 'free camera from above');
        expect(high, `draw calls over ${DRAW_CALL_BUDGET} from above`).toBeLessThanOrEqual(
          DRAW_CALL_BUDGET,
        );
        // then raise the gaze to the horizon, where the skyline and the mirrors' far side show
        await dragPane(page, 1000);
        await dragPane(page, 1000);
        const level = await drawnCalls(page, run, 'free camera at the horizon');
        expect(level, `draw calls over ${DRAW_CALL_BUDGET} at the horizon`).toBeLessThanOrEqual(
          DRAW_CALL_BUDGET,
        );
      },
    );
  }
}
