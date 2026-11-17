import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';

const speed = (page: Page) => page.locator('[data-hud="speed"]');
const sheet = (page: Page) => page.getByRole('dialog', { name: en.paused });

async function startAndRoll(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(speed(page)).toHaveText('0.0 km/h');
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(speed(page)).not.toHaveText('0.0 km/h');
}

test('back pauses the drive and back again continues', async ({ page }) => {
  await startAndRoll(page);
  await page.goBack();
  await expect(sheet(page)).toBeVisible();

  const paused = await speed(page).textContent();
  await page.waitForTimeout(500);
  await expect(speed(page)).toHaveText(paused ?? '');

  await page.goBack();
  await expect(sheet(page)).toBeHidden();
  await expect(speed(page)).not.toHaveText(paused ?? '');
});

test('the sheet takes the keyboard: Space continues instead of braking', async ({ page }) => {
  await startAndRoll(page);
  await page.goBack();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(sheet(page)).toBeHidden();
  await expect(speed(page)).not.toHaveText('0.0 km/h');
});

test('restart leaves no result and no replay', async ({ page }) => {
  await startAndRoll(page);
  await page.goBack();
  await sheet(page).getByRole('button', { name: en.restart }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(speed(page)).toHaveText('0.0 km/h');

  // A reload returns to the menu, where an unscored restart must have stored nothing.
  await page.reload();
  await expect(page.getByRole('heading', { name: en.appName })).toBeVisible();
  await expect(page.getByRole('button', { name: en.replayLastRun })).toHaveCount(0);
});

test('finish scores, back leaves the result, and the replay names the exercise', async ({
  page,
}) => {
  await startAndRoll(page);
  await page.getByRole('button', { name: en.finish }).click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: en.finish }).click();
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: en.appName })).toBeVisible();
  const replay = page.getByRole('button', { name: en.replayLastRun });
  await expect(replay).toContainText(en.exerciseStraightReverse);
});
