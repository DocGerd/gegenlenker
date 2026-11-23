import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';

// Registration fails without a worker, so the shell shows its real offlineSetupFailed toast.
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

async function leaveRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: en.pause }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.leaveUnscored })
    .click();
  await expect(page.getByRole('heading', { name: en.appName })).toBeVisible();
}

async function finishRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: en.pause }).click();
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

test('the screen wake lock is also released when a drive is left unscored', async ({ page }) => {
  await stubWakeLock(page);
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
  await expect.poll(() => wakeLockLog(page)).toEqual({ requests: 1, released: 0 });

  await leaveRun(page);
  await expect.poll(() => wakeLockLog(page)).toEqual({ requests: 1, released: 1 });
});

test('the update toast is shown at the menu and result, and hidden by CSS over a drive or replay', async ({
  page,
}) => {
  await page.goto('./');
  const toast = page.locator('.update-toast');
  await expect(toast).toHaveText(new RegExp(en.offlineSetupFailed));
  await expect(toast).toBeVisible();

  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
  await expect(toast).toHaveCount(1);
  await expect(toast).toBeHidden();

  await finishRun(page);
  await expect(toast).toBeVisible();

  await page.getByRole('button', { name: en.replay }).click();
  await expect(page.getByRole('slider', { name: en.timeline })).toBeVisible();
  await expect(toast).toHaveCount(1);
  await expect(toast).toBeHidden();
});
