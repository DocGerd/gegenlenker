import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { exerciseEntry, openSetup, startControl, startExercise } from './menu-flow';
import { seedStorage } from './menu-seed';
import { heavyAt } from './pinned-shoot';

// A service worker would answer the chunk request itself, past page.route.
test.use({ serviceWorkers: 'block' });

const DRIVE_CHUNK = '**/assets/drive-*.js';
const historyState = (page: Page): Promise<unknown> =>
  page.evaluate(() => history.state as unknown);

test('Retry loads the drive screen once the failed chunk request can succeed', async ({
  page,
  allow,
}) => {
  // The aborted chunk request logs a resource-load error and rejects the dynamic import.
  allow(/net::ERR_FAILED|Failed to fetch dynamically imported module: .*\/assets\/drive-/);
  let offline = true;
  await page.route(DRIVE_CHUNK, async (route) => {
    if (offline) await route.abort();
    else await route.continue();
  });

  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  await expect(page.getByRole('alertdialog', { name: en.loadFailed })).toBeVisible();
  await expect(page.getByRole('button', { name: en.retry })).toBeFocused();

  offline = false;
  await page.getByRole('button', { name: en.retry }).click();
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
});

test(
  'Esc and goBack while Start is busy change nothing, and the drive then mounts',
  heavyAt('low'),
  async ({ page }) => {
    await seedStorage(page, { settings: { graphics: 'low' } });
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await page.route(DRIVE_CHUNK, async (route) => {
      await gate;
      await route.continue();
    });
    const entry = exerciseEntry('straight-reverse');
    const setup = page.locator('[data-screen="setup"]');
    const start = startControl(page, en, entry);

    await page.goto('./');
    await openSetup(page, en, entry);
    await start.click();
    await expect(start).toBeDisabled();
    await expect(start).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Escape');
    await expect(setup).toBeVisible();
    await page.goBack();
    await expect(setup).toBeVisible();
    // The popped entry is pushed again, so the drive still takes one over.
    await expect.poll(() => historyState(page)).not.toBeNull();
    await expect(start).toBeDisabled();

    open();
    await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
    await expect(setup).toHaveCount(0);
    await expect(page.locator('.drive')).toHaveCount(1);
  },
);

test('a failed drive load ends the busy Start with the notice, and Back lands on the title without a stale entry', async ({
  page,
  allow,
}) => {
  allow(/net::ERR_FAILED|Failed to fetch dynamically imported module: .*\/assets\/drive-/);
  await page.route(DRIVE_CHUNK, (route) => route.abort());

  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  const notice = page.getByRole('alertdialog', { name: en.loadFailed });
  await expect(notice).toBeVisible();
  await expect(page.locator('[data-screen="setup"]')).toHaveCount(0);
  await notice.getByRole('button', { name: en.back }).click();
  await expect(page.getByRole('heading', { level: 1, name: en.appName })).toBeVisible();
  await expect.poll(() => historyState(page)).toBeNull();
});
