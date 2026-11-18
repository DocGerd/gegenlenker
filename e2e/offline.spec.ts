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

  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });

  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A reload proves the page is served under service-worker control.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  expect(foreign).toEqual([]);
  const status = page.locator('[data-menu="offline"]');
  await expect(status).toHaveText(en.offlineReady);

  // Precaching is part of installing the worker, so the cab shell is cached before going offline.
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.filter((url) => /man-le-18-280-cab-[\w-]+\.glb$/.test(url))).toHaveLength(1);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: en.appName })).toBeVisible();
  await expect(status).toHaveText(en.offlineReady);

  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  const speed = page.locator('[data-hud="speed"]');
  await expect(speed).toHaveText('0.0 km/h');

  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(speed).not.toHaveText('0.0 km/h');
  expect(foreign).toEqual([]);

  // Set once the shell, loaded from the service-worker cache, has replaced the procedural cab.
  await expect(page.locator('html')).toHaveAttribute('data-cab-shell', 'man-le-18-280');
  expect(warnings.filter((w) => w.includes('Cab shell'))).toEqual([]);
});

test('zooms and pans the top-down view without disturbing the controls', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  const reset = page.getByRole('button', { name: en.resetView });
  const lever = page.locator('[data-ctl="lever"]');
  await expect(reset).toBeDisabled();

  // Landscape: the speed lever sits inside the top-down pane, above the canvas.
  const box = await lever.boundingBox();
  if (box === null) throw new Error('lever has no box');
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => lever.evaluate((el) => el.style.getPropertyValue('--lever')))
    .not.toBe('0');
  await expect(reset).toBeDisabled();

  const free = { x: 1024, y: 400 };
  await page.mouse.move(free.x, free.y);
  await page.mouse.wheel(0, -400);
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();

  await page.mouse.move(free.x, free.y);
  await page.mouse.down();
  await page.mouse.move(free.x - 30, free.y + 20, { steps: 4 });
  await page.mouse.up();
  await expect(reset).toBeEnabled();
});
