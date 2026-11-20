import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';

const SETTINGS_KEY = 'gegenlenker.settings.v1';

test('the menu Day/Night choice sets the drive lighting, both ways', async ({ page }) => {
  await page.addInitScript((key) => {
    // Low keeps the render cheap; only the first load, so the saved choice survives later loads.
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ version: 1, graphics: 'low' }));
    }
  }, SETTINGS_KEY);
  const html = page.locator('html');
  const lighting = page.getByRole('combobox', { name: en.lighting });

  await page.goto('./');
  await expect(lighting).toHaveValue('day');
  await lighting.selectOption('night');
  await page.getByRole('button', { name: en.layoutDepot, exact: true }).click();
  await expect(html).toHaveAttribute('data-render-lighting', 'night');
  await page.locator('[data-hud="action"]').click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.menu })
    .click();

  await expect(lighting).toHaveValue('night');
  await lighting.selectOption('day');
  await page.getByRole('button', { name: en.layoutDepot, exact: true }).click();
  await expect(html).toHaveAttribute('data-render-lighting', 'day');
});

test('a night run keeps its Night label and replays at night while the menu shows day', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ version: 1, graphics: 'low' }));
    }
  }, SETTINGS_KEY);
  const html = page.locator('html');
  await page.goto('./');
  await page.getByRole('combobox', { name: en.lighting }).selectOption('night');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(html).toHaveAttribute('data-render-lighting', 'night');
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: en.finish }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await page.getByRole('button', { name: en.menu }).click();

  const replay = page.getByRole('button', { name: en.replayLastRun });
  await expect(replay).toContainText(en.lightingNight);
  await page.getByRole('combobox', { name: en.lighting }).selectOption('day');
  await expect(replay).toContainText(en.lightingNight);
  await replay.click();
  await expect(page.getByRole('slider', { name: en.timeline })).toBeVisible();
  await expect(html).toHaveAttribute('data-render-lighting', 'night');
});
