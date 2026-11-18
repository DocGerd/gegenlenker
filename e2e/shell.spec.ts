import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';

// No service worker, so only this spec decides when the update toast shows.
test.use({ serviceWorkers: 'block' });

type WakeLockLog = { requests: number; released: number };

async function stubWakeLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log = { requests: 0, released: 0 };
    Reflect.set(window, '__wakeLock', log);
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: () => {
          log.requests += 1;
          const sentinel = new EventTarget();
          return Promise.resolve(
            Object.assign(sentinel, {
              release: () => {
                log.released += 1;
                return Promise.resolve();
              },
            }),
          );
        },
      },
    });
  });
}

const wakeLockLog = (page: Page) =>
  page.evaluate(() => Reflect.get(window, '__wakeLock') as WakeLockLog);

async function finishRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: en.finish }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();
}

test('the screen wake lock is held for the drive and released when it ends', async ({ page }) => {
  await stubWakeLock(page);
  await page.goto('./');
  expect(await wakeLockLog(page)).toEqual({ requests: 0, released: 0 });

  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
  await expect.poll(() => wakeLockLog(page)).toEqual({ requests: 1, released: 0 });

  await finishRun(page);
  await expect.poll(() => wakeLockLog(page)).toEqual({ requests: 1, released: 1 });
});

test('a pending update is offered at the menu and result, never over a drive or replay', async ({
  page,
}) => {
  await page.goto('./');
  const toast = page.locator('.update-toast');
  // The shell only unhides the toast for a waiting worker; fake that state.
  await toast.evaluate((el) => {
    el.textContent = 'Update available';
    el.removeAttribute('hidden');
  });
  await expect(toast).toBeVisible();

  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
  await expect(toast).toBeHidden();

  await finishRun(page);
  await expect(toast).toBeVisible();

  await page.getByRole('button', { name: en.replay }).click();
  await expect(page.getByRole('slider', { name: en.timeline })).toBeVisible();
  await expect(toast).toBeHidden();
});
