import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/en';

test('loads from the subpath and drives an exercise offline', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  // Context level, so requests made by the service worker are seen too.
  context.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'))
      foreign.push(url);
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
