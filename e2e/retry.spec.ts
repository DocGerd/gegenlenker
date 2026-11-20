import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';

// A service worker would answer the chunk request itself, past page.route.
test.use({ serviceWorkers: 'block' });

test('Retry loads the drive screen once the failed chunk request can succeed', async ({
  page,
  allow,
}) => {
  // The aborted chunk request logs a resource-load error and rejects the dynamic import.
  allow(/net::ERR_FAILED|Failed to fetch dynamically imported module: .*\/assets\/drive-/);
  let offline = true;
  await page.route('**/assets/drive-*.js', async (route) => {
    if (offline) await route.abort();
    else await route.continue();
  });

  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.getByText(en.loadFailed)).toBeVisible();

  offline = false;
  await page.getByRole('button', { name: en.retry }).click();
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
});
