import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DRAW_CALL_BUDGET, QUALITY_FLAGS } from '../src/render/quality';
import { drawnBackend, parseOverlay } from './perf/tablet-logic';
import { FREE_FOV } from '../src/render/free-look';
import type { LightingMode } from '../src/contracts/render';
import {
  type Preset,
  settle,
  slowAt,
  startPinnedDrive,
  step,
  timeoutWithSettles,
} from './pinned-shoot';
import { exerciseEntry, type MenuEntry } from './menu-flow';

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

/** Wheel notches that carry the eye past the yard's bounds from the greatest height. */
const FLY_BACK_NOTCHES = 3;

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

async function startAtFullSize(
  page: Page,
  { preset, lighting }: Run,
  entry: MenuEntry = exerciseEntry('straight-reverse'),
): Promise<void> {
  // the load and its first settle draw at a smaller size, which costs less on software GL
  await page.setViewportSize({ width: 1280, height: 720 });
  await startPinnedDrive(page, { preset, lighting }, entry, '?perf=1');
  // every mirror draws at this size: budget the worst case
  const backingWidth = (): Promise<number> =>
    page.evaluate(() => document.querySelector('canvas')?.width ?? 0);
  const small = await backingWidth();
  await page.setViewportSize({ width: 1920, height: 1080 });
  // the app sees the size through a ResizeObserver, which resizes the canvas and re-arranges the views
  await expect.poll(backingWidth).toBeGreaterThan(small);
}

/** One pointer drag from the pane's centre, `dx` px right and `dy` px down, as the free camera reads it. */
async function dragPane(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('[data-hud="topDown"]').boundingBox();
  if (box === null) throw new Error('no top-down pane');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

async function startFreeCamera(page: Page, run: Run): Promise<void> {
  await startAtFullSize(page, run);
  await page.keyboard.press('k');
  // the pinned clock holds the frame that starts the flight
  await step(page, 3);
  await expect(page.locator('[data-hud="freeCamera"]')).toHaveAttribute('aria-pressed', 'true');
}

/** Looks straight down, then flies back along the gaze: up to the greatest height. */
async function flyToGreatestHeight(page: Page): Promise<void> {
  await lookPane(page, 0, -90);
  await page.mouse.wheel(0, 1000);
  await page.mouse.wheel(0, 1000);
}

/** Flies back along the gaze for longer than the yard is wide. */
async function flyBack(page: Page): Promise<void> {
  for (let i = 0; i < FLY_BACK_NOTCHES; i++) await page.mouse.wheel(0, 1000);
}

/** Turns the gaze left by `yaw` degrees and raises it by `pitch` (negative turns right, lowers it) with pointer drags. */
async function lookPane(page: Page, yaw: number, pitch: number): Promise<void> {
  const box = await page.locator('[data-hud="topDown"]').boundingBox();
  if (box === null) throw new Error('no top-down pane');
  const pxPerDegree = box.height / FREE_FOV;
  const reach = Math.min(box.width, box.height) * 0.4;
  let dx = yaw * pxPerDegree;
  let dy = pitch * pxPerDegree;
  while (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    const sx = Math.max(-reach, Math.min(reach, dx));
    const sy = Math.max(-reach, Math.min(reach, dy));
    await dragPane(page, sx, sy);
    dx -= sx;
    dy -= sy;
  }
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

  // every preset: the view and the arms are the mode, not a realism layer, so Low draws them too
  test(
    `the Einweiser view and his arms stay within the draw-call budget at ${label}, with the driver's shadow passes`,
    slowAt(preset),
    async ({ context }) => {
      test.setTimeout(timeoutWithSettles(preset, 2));
      const page = await context.newPage();
      await startAtFullSize(page, run, {
        ...exerciseEntry('straight-reverse'),
        role: 'einweiser',
      });
      const calls = await drawnCalls(page, run, 'Einweiser view');
      expect(calls, `draw calls over ${DRAW_CALL_BUDGET}`).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    },
  );

  // High only: the free camera sees the most from the greatest height, and the lower presets draw less of it
  if (preset === 'high') {
    test(
      `the free camera stays within the draw-call budget at ${label}, from the greatest height`,
      slowAt(preset),
      async ({ context }) => {
        test.setTimeout(timeoutWithSettles(preset, 2));
        const page = await context.newPage();
        await startFreeCamera(page, run);
        await flyToGreatestHeight(page);
        const calls = await drawnCalls(page, run, 'free camera from above');
        expect(calls, `draw calls over ${DRAW_CALL_BUDGET} from above`).toBeLessThanOrEqual(
          DRAW_CALL_BUDGET,
        );
      },
    );

    test(
      `the free camera stays within the draw-call budget at ${label}, looking across the yard to the horizon from a corner at the greatest height`,
      slowAt(preset),
      async ({ context }) => {
        test.setTimeout(timeoutWithSettles(preset, 2));
        const page = await context.newPage();
        await startFreeCamera(page, run);
        await flyToGreatestHeight(page);
        // gaze across the yard and fly back along it: the bounds stop the eye at a corner, one
        // axis at a time, so a quarter turn and a second flight leave it in one whichever way it began
        await lookPane(page, 0, 60);
        await flyBack(page);
        await lookPane(page, 90, 0);
        await flyBack(page);
        // the flight ends looking back over what it crossed: raise the gaze until the skyline shows
        await lookPane(page, 0, 13);
        const calls = await drawnCalls(page, run, 'free camera across the yard from a corner');
        expect(calls, `draw calls over ${DRAW_CALL_BUDGET} from a corner`).toBeLessThanOrEqual(
          DRAW_CALL_BUDGET,
        );
      },
    );
  }
}
