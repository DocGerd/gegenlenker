import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';

const SETTINGS_KEY = 'gegenlenker.settings.v1';

async function start(page: Page, settings: object): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [SETTINGS_KEY, JSON.stringify({ version: 1, ...settings })] as const,
  );
  await page.goto('./?framing=1');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
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
