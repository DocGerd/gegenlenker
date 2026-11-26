import { expect, test } from '../fixtures';
import { en } from '../../src/i18n/en';
import { chooseSetting } from '../menu-flow';

// The production dist serves a UAT build inside `uat/`: the production worker's scope contains the
// UAT one's, so each channel must leave the other's pages, keys and caches alone.
const PRODUCTION = '/gegenlenker/';
const UAT = '/gegenlenker/uat/';

const open = (page: import('@playwright/test').Page, path: string) => page.goto(path);

/** Resolves once the worker of this scope has finished activating, which is when Workbox cleans caches. */
async function activated(page: import('@playwright/test').Page, scopePath: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (path) => {
          const registrations = await navigator.serviceWorker.getRegistrations();
          const found = registrations.find((r) => new URL(r.scope).pathname === path);
          return found?.active?.state ?? 'none';
        }, scopePath),
      { timeout: 30_000 },
    )
    .toBe('activated');
}

const precacheNames = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => (await caches.keys()).filter((name) => name.includes('-precache-')));

test('the UAT build is not indexed and says so in its title', async ({ request }) => {
  const html = await (await request.get(UAT)).text();
  expect(html).toContain('<meta name="robots" content="noindex"');
  expect(html).toContain('<title>Gegenlenker UAT</title>');
  const production = await (await request.get(PRODUCTION)).text();
  expect(production).not.toContain('noindex');
  expect(production).toContain('<title>Gegenlenker</title>');
});

test('the UAT worker owns only its own scope and cache', async ({ page, request }) => {
  await open(page, UAT);
  await activated(page, UAT);
  const scopes = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname),
  );
  expect(scopes).toEqual([UAT]);

  const origin = new URL(page.url()).origin;
  expect(await precacheNames(page)).toEqual([`workbox-precache-v2-${origin}${UAT}`]);
  const caches = await page.evaluate(() => globalThis.caches.keys());
  expect(caches).not.toContain('ground-texture');

  const uatWorker = await (await request.get(`${UAT}sw.js`)).text();
  expect(uatWorker).toContain('cacheName:"gegenlenker-uat-ground-texture"');
  expect(uatWorker).not.toContain('cacheName:"ground-texture"');
  const productionWorker = await (await request.get(`${PRODUCTION}sw.js`)).text();
  expect(productionWorker).toContain('cacheName:"ground-texture"');
});

test('the UAT build writes only gegenlenker-uat keys and shows its badge', async ({ page }) => {
  await open(page, UAT);
  await expect(page.locator('[data-menu="channel"]')).toHaveText(en.channelUat);
  await expect(page.locator('[data-menu="build"]')).toContainText('Development build');
  await chooseSetting(page, en, 'language', 'de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');

  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain('gegenlenker-uat.settings.v1');
  expect(keys.filter((key) => !key.startsWith('gegenlenker-uat.'))).toEqual([]);
});

test('the production build shows no UAT badge', async ({ page }) => {
  await open(page, PRODUCTION);
  await expect(page.locator('[data-menu="build"]')).toBeVisible();
  await expect(page.locator('[data-menu="channel"]')).toHaveCount(0);
});

test('an installed production worker does not answer a navigation to the UAT build', async ({
  page,
}) => {
  await open(page, PRODUCTION);
  await activated(page, PRODUCTION);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.locator('[data-menu="offline"]')).toHaveText(en.offlineReady);

  await open(page, UAT);
  await expect(page).toHaveTitle('Gegenlenker UAT');
  await expect(page.locator('[data-menu="channel"]')).toHaveText(en.channelUat);
  await activated(page, UAT);

  // Once the UAT worker is installed, a reload is served by it, still as the UAT app.
  await page.reload();
  expect(new URL(page.url()).pathname).toBe(UAT);
  await expect(page).toHaveTitle('Gegenlenker UAT');
});

for (const [first, second] of [
  [PRODUCTION, UAT],
  [UAT, PRODUCTION],
] as const) {
  test(`both precaches survive the other's activation (${first} then ${second})`, async ({
    page,
  }) => {
    await open(page, first);
    await activated(page, first);
    await open(page, second);
    await activated(page, second);

    const origin = new URL(page.url()).origin;
    expect((await precacheNames(page)).sort()).toEqual(
      [`workbox-precache-v2-${origin}${PRODUCTION}`, `workbox-precache-v2-${origin}${UAT}`].sort(),
    );
  });
}
