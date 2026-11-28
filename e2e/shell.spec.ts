import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { startExercise } from './menu-flow';

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

  await startExercise(page, en, 'straight-reverse');
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
  await expect.poll(() => wakeLockLog(page)).toEqual({ requests: 1, released: 0 });

  await finishRun(page);
  await expect.poll(() => wakeLockLog(page)).toEqual({ requests: 1, released: 1 });
});

test('the screen wake lock is also released when a drive is left unscored', async ({ page }) => {
  await stubWakeLock(page);
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
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

  await startExercise(page, en, 'straight-reverse');
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

test('the result keeps its actions clear of the update toast at 1280x585', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 585 });
  await page.goto('./');
  const toast = page.locator('.update-toast');
  await expect(toast).toBeVisible();
  await startExercise(page, en, 'straight-reverse');
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
  await finishRun(page);
  await expect(toast).toBeVisible();
  // The drive hid the toast, so the reserve is 0 until its ResizeObserver sees it shown again.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          parseFloat(
            getComputedStyle(document.querySelector('#app') ?? document.body).getPropertyValue(
              '--toast-reserve',
            ),
          ) || 0,
      ),
    )
    .toBeGreaterThan(0);

  await page.locator('.result').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const toastBox = await toast.boundingBox();
  if (toastBox === null) throw new Error('no toast box');
  const actions = page.locator('.result-actions .app-button');
  expect(await actions.count()).toBeGreaterThan(0);
  for (const action of await actions.all()) {
    const box = await action.boundingBox();
    if (box === null) throw new Error('no action box');
    expect(box.y + box.height, 'an action ends above the toast').toBeLessThanOrEqual(toastBox.y);
  }
});
