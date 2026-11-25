import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { startExercise } from './menu-flow';

const SETTINGS_KEY = 'gegenlenker.settings.v1';

async function start(page: Page, settings: object): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [SETTINGS_KEY, JSON.stringify({ version: 1, ...settings })] as const,
  );
  await page.goto('./?framing=1');
  await startExercise(page, en, 'straight-reverse');
  await expect(page.locator('[data-view="follow"]')).toBeVisible();
}

test('the chase view orbits and zooms without errors, hides the target arrow and the top-down aids, and is not stored', async ({
  page,
}) => {
  await start(page, {});
  await page.locator('[data-view="chase"]').click();
  await expect(page.locator('[data-view="chase"]')).toHaveAttribute('aria-pressed', 'true');
  for (const aid of ['path', 'tracks', 'ghost']) {
    await expect(page.locator(`[data-aid="${aid}"]`)).toBeDisabled();
  }
  await expect(page.locator('[data-aid="pivots"]')).toBeEnabled();
  const legendToggle = page.locator('[data-hud="aidLegendToggle"]');
  await legendToggle.click();
  await expect(legendToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-aid-legend="path"]')).toHaveAttribute('data-disabled', '');
  await expect(page.locator('[data-aid-legend="pivots"]')).not.toHaveAttribute('data-disabled');
  const pane = await page.locator('.hud-topdown').boundingBox();
  if (pane === null) throw new Error('no top-down pane');
  const x = pane.x + pane.width / 2;
  const y = pane.y + pane.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 30, { steps: 5 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await expect(page.locator('[data-hud="resetView"]')).toBeEnabled();
  await expect(page.locator('[data-hud="targetArrow"]')).toBeHidden();
  const stored = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
  expect(JSON.parse(stored ?? '{}')).not.toMatchObject({ topDown: 'chase' });
  await page.locator('[data-view="yard"]').click();
  await expect(page.locator('[data-aid="path"]')).toBeEnabled();
  await expect(page.locator('[data-aid-legend="path"]')).not.toHaveAttribute('data-disabled');
  await page.keyboard.press('o');
  await expect(page.locator('[data-view="chase"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a drive starts in the stored follow or yard view, never in chase', async ({ page }) => {
  await start(page, { topDown: 'chase' });
  await expect(page.locator('[data-view="follow"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-view="chase"]')).toBeVisible();
});

test('Low graphics offers no chase view and ignores its key', async ({ page }) => {
  await start(page, { graphics: 'low' });
  await expect(page.locator('[data-view="chase"]')).toBeHidden();
  await page.keyboard.press('o');
  await expect(page.locator('[data-view="follow"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the free camera starts from the outside view, flies and leaves back to the orbit, and is not stored', async ({
  page,
}) => {
  await start(page, {});
  const free = page.locator('[data-hud="freeCamera"]');
  const chase = page.locator('[data-view="chase"]');
  const reset = page.locator('[data-hud="resetView"]');
  await expect(free).toHaveAttribute('aria-pressed', 'false');
  await expect(reset).toBeDisabled();

  // from the follow view the key switches to the outside view first
  await page.keyboard.press('k');
  await expect(chase).toHaveAttribute('aria-pressed', 'true');
  await expect(free).toHaveAttribute('aria-pressed', 'true');
  await expect(reset).toBeEnabled();

  const pane = await page.locator('.hud-topdown').boundingBox();
  if (pane === null) throw new Error('no top-down pane');
  const x = pane.x + pane.width / 2;
  const y = pane.y + pane.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(x - 60, y - 20, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.mouse.wheel(0, -300);
  await page.keyboard.down('Minus');
  await page.waitForTimeout(300);
  await page.keyboard.up('Minus');
  await expect(free).toHaveAttribute('aria-pressed', 'true');

  // the second press returns to the orbit, which the free camera never touched
  await page.keyboard.press('k');
  await expect(free).toHaveAttribute('aria-pressed', 'false');
  await expect(chase).toHaveAttribute('aria-pressed', 'true');
  await expect(reset).toBeDisabled();

  // the button toggles it too; the reset key ends it with the orbit at its default
  await free.click();
  await expect(free).toHaveAttribute('aria-pressed', 'true');
  // enabled once the flight has started
  await expect(reset).toBeEnabled();
  await page.keyboard.press('0');
  await expect(free).toHaveAttribute('aria-pressed', 'false');
  await expect(chase).toHaveAttribute('aria-pressed', 'true');

  // another view ends it
  await page.keyboard.press('k');
  await expect(free).toHaveAttribute('aria-pressed', 'true');
  await expect(reset).toBeEnabled();
  await page.keyboard.press('f');
  await expect(page.locator('[data-view="follow"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(free).toHaveAttribute('aria-pressed', 'false');

  const stored = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
  expect(JSON.parse(stored ?? '{}')).not.toMatchObject({ topDown: 'chase' });
  expect(stored ?? '').not.toMatch(/free/i);
});

test('Low graphics offers no free camera and ignores its key', async ({ page }) => {
  await start(page, { graphics: 'low' });
  await expect(page.locator('[data-hud="freeCamera"]')).toHaveCount(0);
  await page.keyboard.press('k');
  await expect(page.locator('[data-view="follow"]')).toHaveAttribute('aria-pressed', 'true');
});
