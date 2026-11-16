import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/en';

test('loads from the subpath and drives an exercise offline', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) foreign.push(r.url());
  });

  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A reload proves the page is served under service-worker control.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  expect(foreign).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: en.appName })).toBeVisible();

  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  const speed = page.locator('[data-hud="speed"]');
  await expect(speed).toHaveText('0.0 km/h');

  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(speed).not.toHaveText('0.0 km/h');
  expect(foreign).toEqual([]);
});
