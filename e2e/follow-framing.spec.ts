import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { MAX_STEPS_PER_FRAME } from '../src/sim/constants';
import { DEFAULT_GRAPHICS, DEFAULT_LIGHTING } from '../src/contracts/render';
import { HEAVY, settle, startPinnedDrive, timeoutWithSettles } from './pinned-shoot';
import { exerciseEntry, startExercise } from './menu-flow';
import { EXERCISE_IDS } from '../src/contracts/exercise';

/** The settings a fresh install draws with, so the framing is checked as a new user sees it. */
const DEFAULTS = { preset: DEFAULT_GRAPHICS, lighting: DEFAULT_LIGHTING } as const;

const sizes = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 },
];
/** Sim steps to let the camera follow a manoeuvre before checking the framing. */
const STEPS = 90;
const CHROME = '[data-chrome], .ctl-steer, .ctl-gears, .ctl-pedals';

type Box = { left: number; top: number; right: number; bottom: number; step: number };

async function start(page: Page, size: (typeof sizes)[number]): Promise<void> {
  await page.setViewportSize(size);
  await startPinnedDrive(page, DEFAULTS, exerciseEntry('straight-reverse'));
}

async function vehicleBox(page: Page): Promise<Box> {
  const stage = page.locator('.drive');
  await expect(stage).toHaveAttribute('data-vehicle-box', /left/);
  return JSON.parse((await stage.getAttribute('data-vehicle-box')) ?? 'null') as Box;
}

/**
 * Jumps the pinned clock until the sim has run `steps` more steps, then returns the box of that frame.
 * Each jump is one frame of at most `MAX_STEPS_PER_FRAME` sim steps, as on a device that draws slowly,
 * so a frame is drawn per jump rather than per step.
 */
async function afterSteps(page: Page, steps: number): Promise<Box> {
  const from = (await vehicleBox(page)).step;
  let box = await vehicleBox(page);
  for (let jumps = 0; box.step - from < steps; jumps++) {
    expect(jumps, `sim steps after ${jumps} frames`).toBeLessThan(Math.ceil(steps / 2));
    const run = Math.min(MAX_STEPS_PER_FRAME, steps - (box.step - from));
    await page.clock.fastForward((run * 1000) / 60 + 1);
    box = await vehicleBox(page);
  }
  return box;
}

async function chromeHits(page: Page, box: Box): Promise<string[]> {
  const chrome = await page.locator(CHROME).evaluateAll((els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
  );
  expect(chrome.length).toBeGreaterThan(0);
  return chrome
    .filter(
      (c) => box.left < c.right && c.left < box.right && box.top < c.bottom && c.top < box.bottom,
    )
    .map((c) => JSON.stringify(c));
}

async function expectClear(page: Page, box: Box): Promise<void> {
  const hits = await chromeHits(page, box);
  expect(hits, `vehicle ${JSON.stringify(box)} overlaps chrome`).toEqual([]);
  const pane = await page.locator('[data-hud="topDown"]').boundingBox();
  expect(pane).not.toBeNull();
  expect(box.left).toBeGreaterThanOrEqual(pane?.x ?? 0);
  expect(box.right).toBeLessThanOrEqual((pane?.x ?? 0) + (pane?.width ?? 0));
  expect(box.top).toBeGreaterThanOrEqual(pane?.y ?? 0);
  expect(box.bottom).toBeLessThanOrEqual((pane?.y ?? 0) + (pane?.height ?? 0));
}

for (const size of sizes) {
  for (const folded of [false, true]) {
    const name = `${size.width}x${size.height} ${folded ? 'panels collapsed' : 'panels open'}`;

    test(
      `follow framing keeps the vehicle clear of the chrome at ${name}`,
      { tag: HEAVY },
      async ({ page }) => {
        test.setTimeout(timeoutWithSettles(DEFAULTS.preset, 1));
        await start(page, size);
        if (folded) {
          await page.getByRole('button', { name: en.panelAids, exact: true }).click();
          await page.getByRole('button', { name: en.panelGauges, exact: true }).click();
        }
        await expectClear(page, await vehicleBox(page));

        for (const gear of ['2', '4']) {
          await page.keyboard.press(gear);
          for (let i = 0; i < 6; i++) await page.keyboard.press('w');
          await expectClear(page, await afterSteps(page, STEPS));
          // Steering while moving bends the combination, the widest pose for the bounding circle.
          for (const steer of ['a', 'd']) {
            await page.keyboard.down(steer);
            await expectClear(page, await afterSteps(page, STEPS));
            await page.keyboard.up(steer);
            await expectClear(page, await afterSteps(page, STEPS));
          }
          await page.keyboard.press('1');
        }
      },
    );
  }
}

const yardSizes = [
  { width: 1280, height: 649 },
  { width: 1280, height: 720 },
];
const locales = [
  { locale: 'en-US', messages: en },
  { locale: 'de-DE', messages: de },
];

for (const { locale, messages } of locales) {
  for (const size of yardSizes) {
    test(
      `whole-yard framing keeps the start and the target clear of the chrome at ${locale} ${size.width}x${size.height}`,
      { tag: HEAVY },
      async ({ browser }) => {
        test.setTimeout(timeoutWithSettles(DEFAULTS.preset, 2 * EXERCISE_IDS.length));
        const context = await browser.newContext({ locale, viewport: size });
        for (const id of EXERCISE_IDS) {
          const page = await context.newPage();
          await startPinnedDrive(page, DEFAULTS, exerciseEntry(id));
          await page.getByRole('button', { name: messages.viewYard, exact: true }).click();
          // The box still shows the last follow frame until a frame drawn after the click.
          await afterSteps(page, 1);
          await settle(page, DEFAULTS.preset);
          expect(await chromeHits(page, await vehicleBox(page)), id).toEqual([]);
          // The arrow shows only for a target outside the clear rect.
          await expect(page.locator('[data-hud="targetArrow"]'), id).toBeHidden();
          await page.close();
        }
        await context.close();
      },
    );
  }
}

test('the arrow points at a target that is off-screen at the start', async ({ page }) => {
  await start(page, sizes[0] as (typeof sizes)[number]);
  await expect(page.locator('[data-hud="targetArrow"] svg')).toBeVisible();
});

test('collapsed panels stay collapsed in the next run', async ({ page }) => {
  await start(page, sizes[0] as (typeof sizes)[number]);
  await page.getByRole('button', { name: en.panelAids, exact: true }).click();
  await expect(page.locator('[data-hud="aids"]')).toBeHidden();
  await page.reload();
  await startExercise(page, en, 'straight-reverse');
  await expect(page.locator('[data-hud="aids"]')).toBeHidden();
  await expect(page.locator('[data-hud="gauges"]')).toBeVisible();
});
