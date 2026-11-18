import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';

const SETTINGS_KEY = 'gegenlenker.settings.v1';

async function start(page: Page, settings: object): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [SETTINGS_KEY, JSON.stringify({ version: 1, ...settings })] as const,
  );
  await page.goto('./?framing=1');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('[data-view="follow"]')).toBeVisible();
  return errors;
}

test('the chase view orbits and zooms without errors, and hides the target arrow', async ({
  page,
}) => {
  const errors = await start(page, { topDown: 'chase' });
  const chase = page.locator('[data-view="chase"]');
  await expect(chase).toHaveAttribute('aria-pressed', 'true');
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
  await page.locator('[data-view="yard"]').click();
  await page.locator('[data-view="chase"]').click();
  await expect(page.locator('[data-hud="targetArrow"]')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Low graphics hides the chase view and a stored one shows follow', async ({ page }) => {
  const errors = await start(page, { topDown: 'chase', graphics: 'low' });
  await expect(page.locator('[data-view="chase"]')).toBeHidden();
  await expect(page.locator('[data-view="follow"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
