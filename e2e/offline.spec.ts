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
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
    // Offline reloads log resource-load failures for unprecached requests.
    if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

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

  // Precaching is part of installing the worker, so every shell is cached before going offline.
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
  const shells = [
    ...['arocs-1835-ak', 'man-le-18-280'].flatMap((truck) => [`${truck}-cab`, `${truck}-body`]),
    ...['krone-azw-18', 'hueffermann-hpa-24-81-l'].map((trailer) => `${trailer}-trailer`),
  ];
  for (const key of shells) {
    const shell = new RegExp(`${key}-[\\w-]+\\.glb$`);
    expect(
      cached.filter((url) => shell.test(url)),
      key,
    ).toHaveLength(1);
  }

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

  // Set once the shells, loaded from the service-worker cache, have replaced the procedural meshes.
  await expect(page.locator('html')).toHaveAttribute(
    'data-vehicle-shells',
    'krone-azw-18-trailer man-le-18-280-body man-le-18-280-cab',
  );
  expect(warnings.filter((w) => w.includes('Shell '))).toEqual([]);
  expect(errors).toEqual([]);
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

test('High graphics caches the ground texture and transcoder on first use and applies them offline', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  context.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'))
      foreign.push(url);
  });
  let offline = false;
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
    if (m.type() === 'error' && !(offline && /net::ERR_/.test(m.text()))) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      'gegenlenker.settings.v1',
      JSON.stringify({ version: 1, graphics: 'high' }),
    );
  });

  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.locator('[data-menu="offline"]')).toHaveText(en.offlineReady);

  const cached = async (): Promise<{ precache: string[]; runtime: string[] }> =>
    page.evaluate(async () => {
      const urls: Record<'precache' | 'runtime', string[]> = { precache: [], runtime: [] };
      for (const name of await caches.keys()) {
        const bucket = name.includes('precache') ? urls.precache : urls.runtime;
        for (const request of await (await caches.open(name)).keys()) bucket.push(request.url);
      }
      return urls;
    });
  const files = [
    /ground-[\w-]+\.ktx2$/,
    /basis_transcoder-[\w-]+\.js$/,
    /basis_transcoder-[\w-]+\.wasm$/,
  ];
  const matching = (urls: string[], file: RegExp): string[] => urls.filter((url) => file.test(url));

  // Installing does not download them: only High draws the texture, so the other presets skip the cost.
  const installed = await cached();
  for (const file of files) expect(matching(installed.precache, file), String(file)).toEqual([]);

  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  const marker = page.locator('html');
  await expect(marker).toHaveAttribute('data-ground-texture', /^ktx2:[a-z0-9-]+$/);
  const target = await marker.getAttribute('data-ground-texture');
  await expect(marker).toHaveAttribute('data-vehicle-pbr', 'on');
  await expect
    .poll(async () => {
      const { runtime } = await cached();
      return files.map((file) => matching(runtime, file).length);
    })
    .toEqual([1, 1, 1]);

  // The marker follows the preset: Balanced draws no reflections, so it is gone.
  await page.getByRole('button', { name: en.finish }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await page.getByRole('button', { name: en.menu }).click();
  await page.locator('[data-menu="graphics"]').selectOption('balanced');
  // the menu now also offers the replay of the run just finished
  await page.getByRole('button', { name: new RegExp(`^${en.exerciseStraightReverse}`) }).click();
  await expect(page.locator('[data-view="follow"]')).toBeVisible();
  await expect(marker).not.toHaveAttribute('data-vehicle-pbr', /.*/);

  offline = true;
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: new RegExp(`^${en.exerciseStraightReverse}`) }).click();
  await expect(marker).toHaveAttribute('data-ground-texture', target ?? '');
  await expect(marker).toHaveAttribute('data-vehicle-pbr', 'on');
  expect(warnings.filter((w) => /Ground texture|Vehicle reflection/.test(w))).toEqual([]);
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});
