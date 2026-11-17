import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';

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
  await page.goto('./?framing=1');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
}

async function vehicleBox(page: Page): Promise<Box> {
  const stage = page.locator('.drive');
  await expect(stage).toHaveAttribute('data-vehicle-box', /left/);
  return JSON.parse((await stage.getAttribute('data-vehicle-box')) ?? 'null') as Box;
}

/** Waits until the sim has run `steps` more steps, then returns the box of that frame. */
async function afterSteps(page: Page, steps: number): Promise<Box> {
  const from = (await vehicleBox(page)).step;
  let box = await vehicleBox(page);
  await expect
    .poll(async () => {
      box = await vehicleBox(page);
      return box.step - from;
    })
    .toBeGreaterThanOrEqual(steps);
  return box;
}

async function expectClear(page: Page, box: Box): Promise<void> {
  const chrome = await page.locator(CHROME).evaluateAll((els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
  );
  expect(chrome.length).toBeGreaterThan(0);
  for (const c of chrome) {
    const hit =
      box.left < c.right && c.left < box.right && box.top < c.bottom && c.top < box.bottom;
    expect(hit, `vehicle ${JSON.stringify(box)} overlaps chrome ${JSON.stringify(c)}`).toBe(false);
  }
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

    test(`follow framing keeps the vehicle clear of the chrome at ${name}`, async ({ page }) => {
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
    });
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
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('[data-hud="aids"]')).toBeHidden();
  await expect(page.locator('[data-hud="gauges"]')).toBeVisible();
});
