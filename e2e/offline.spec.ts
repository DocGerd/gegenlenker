import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { ASSET_REGISTRY } from '../src/render/asset-registry';
import { QUALITY_FLAGS } from '../src/render/quality';
import { DEFAULT_GRAPHICS } from '../src/contracts/render';
import { RUNTIME_ASSETS } from '../src/pwa/config';
import { expectNoFailedAttachment, watchFailedAttachments } from './attachment-markers';
import { HEAVY, HIGH_WAIT_MS, PRESET_TIMEOUT_MS } from './pinned-shoot';
import { chooseSetting, startExercise } from './menu-flow';

const high = { timeout: HIGH_WAIT_MS };

test('loads from the subpath and drives an exercise offline', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(PRESET_TIMEOUT_MS.high);
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

  // Precaching is part of installing the worker, so every shell is cached before going offline.
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
  const defaults = QUALITY_FLAGS[DEFAULT_GRAPHICS];
  const drawn = Object.entries(ASSET_REGISTRY).filter(([, { flag }]) => defaults[flag]);
  expect(drawn.map(([stem]) => stem)).toContain('ground');
  for (const [stem, { kind }] of drawn) {
    const file = new RegExp(`${stem}-[\\w-]+\\.${kind}$`);
    expect(
      cached.filter((url) => file.test(url)),
      stem,
    ).toHaveLength(1);
  }

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: en.appName })).toBeVisible();
  await expect(status).toHaveText(en.offlineReady);

  await startExercise(page, en, 'straight-reverse');
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
  await expect(page.locator('html')).toHaveAttribute('data-ground-texture', /^ktx2:/);
  expect(warnings.filter((w) => /Shell |Ground texture/.test(w))).toEqual([]);
});

test('About opens offline after the first visit', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.locator('[data-menu="offline"]')).toHaveText(en.offlineReady);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: en.about, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: en.about, exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { level: 2, name: en.aboutAssets })).toBeVisible();
  await expect(page.locator('[data-about="thirdParty"]')).not.toHaveCount(0);
});

test('choosing High caches its assets before offline-ready shows again', async ({
  page,
  context,
}) => {
  const status = page.locator('[data-menu="offline"]');
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(status).toHaveText(en.offlineReady);

  // High draws assets the default preset does not: they are not cached yet.
  await chooseSetting(page, en, 'graphics', 'high');
  await expect(status).toHaveText(en.offlineReady, { timeout: HIGH_WAIT_MS });
  const urls = await page.evaluate(async () => {
    const found: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) found.push(request.url);
    }
    return found;
  });
  const missing = Object.entries(ASSET_REGISTRY)
    .filter(([, { flag }]) => QUALITY_FLAGS.high[flag] && !QUALITY_FLAGS[DEFAULT_GRAPHICS][flag])
    .filter(
      ([stem, { kind }]) => !urls.some((url) => new RegExp(`${stem}-[\\w-]+\\.${kind}$`).test(url)),
    )
    .map(([stem]) => stem);
  expect(missing).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await expect(status).toHaveText(en.offlineReady);
});

test('zooms and pans the top-down view without disturbing the controls', async ({ page }) => {
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  const reset = page.getByRole('button', { name: en.resetView, exact: true });
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

test(
  'High graphics caches the ground, sky, yard kit and cockpit interior assets before first use and applies them offline',
  {
    tag: HEAVY,
  },
  async ({ page, context, baseURL }) => {
    test.setTimeout(PRESET_TIMEOUT_MS.high);
    const origin = new URL(baseURL ?? '').origin;
    const foreign: string[] = [];
    context.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'))
        foreign.push(url);
    });
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        'gegenlenker.settings.v1',
        JSON.stringify({ version: 1, graphics: 'high' }),
      );
    });
    await watchFailedAttachments(page);

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
    const patterns = (assets: typeof RUNTIME_ASSETS): RegExp[] =>
      assets.flatMap(([stem, extensions]) =>
        extensions.map((extension) => new RegExp(`${stem}-[\\w-]+\\.${extension}$`)),
      );
    const drawn = patterns(
      RUNTIME_ASSETS.filter(([stem]) => {
        const entry = ASSET_REGISTRY[stem];
        return entry !== undefined && QUALITY_FLAGS.high[entry.flag];
      }),
    );
    expect(drawn.map(String).sort()).toEqual(
      [
        /arocs-1835-ak-interior-[\w-]+\.glb$/,
        /asphalt-albedo-[\w-]+\.ktx2$/,
        /asphalt-packed-[\w-]+\.ktx2$/,
        /concrete-albedo-[\w-]+\.ktx2$/,
        /concrete-packed-[\w-]+\.ktx2$/,
        /man-le-18-280-interior-[\w-]+\.glb$/,
        /pavers-albedo-[\w-]+\.ktx2$/,
        /pavers-packed-[\w-]+\.ktx2$/,
        /sky-[\w-]+\.ktx2$/,
        /yard-kit-[\w-]+\.glb$/,
        /yard-kit-atlas-a-[\w-]+\.ktx2$/,
        /yard-kit-atlas-b-[\w-]+\.ktx2$/,
        /yard-kit-leaves-[\w-]+\.ktx2$/,
      ]
        .map(String)
        .sort(),
    );
    const files = patterns(RUNTIME_ASSETS);
    const matching = (urls: string[], file: RegExp): string[] =>
      urls.filter((url) => file.test(url));

    // Installing does not download them: only High draws them, so the other presets skip the cost.
    const installed = await cached();
    for (const file of files) expect(matching(installed.precache, file), String(file)).toEqual([]);
    // Every textured preset needs the transcoder, so installing downloads it.
    for (const extension of ['js', 'wasm']) {
      const transcoder = new RegExp(`basis_transcoder-[\\w-]+\\.${extension}$`);
      expect(matching(installed.precache, transcoder), String(transcoder)).toHaveLength(1);
    }

    // Offline-ready was shown for the saved High preset, so its assets are cached before any drive.
    const prefetched = await cached();
    expect(drawn.map((file) => matching(prefetched.runtime, file).length)).toEqual(
      drawn.map(() => 1),
    );

    await startExercise(page, en, 'straight-reverse');
    const marker = page.locator('html');
    await expect(marker).toHaveAttribute('data-ground-texture', /^ktx2:[a-z0-9-]+$/, high);
    const target = await marker.getAttribute('data-ground-texture');
    await expect(marker).toHaveAttribute('data-ground-pbr', /^ktx2:[a-z0-9-]+$/, high);
    await expect(marker).toHaveAttribute('data-vehicle-pbr', 'on', high);
    await expect(marker).toHaveAttribute('data-sky-hdri', 'on', high);
    await expect(marker).toHaveAttribute('data-yard-kit', 'on', high);
    await expect(marker).toHaveAttribute('data-cockpit-interior', 'on', high);
    await expect(marker).toHaveAttribute('data-perspective-grade', 'on', high);
    // WebGL 2 stays the default until WebGPU passes its gate (docs/perf.md)
    await expect(marker).toHaveAttribute('data-render-backend', 'webgl2', high);
    await expect
      .poll(async () => {
        const { runtime } = await cached();
        return drawn.map((file) => matching(runtime, file).length);
      }, high)
      .toEqual(drawn.map(() => 1));

    // The marker follows the preset: Balanced draws no reflections, so it is gone.
    await page.getByRole('button', { name: en.pause }).click();
    await page
      .getByRole('dialog', { name: en.paused })
      .getByRole('button', { name: en.finish })
      .click();
    await page.getByRole('button', { name: en.menu }).click();
    await chooseSetting(page, en, 'graphics', 'balanced');
    await startExercise(page, en, 'straight-reverse');
    await expect(page.locator('[data-view="follow"]')).toBeVisible();
    await expect(marker).toHaveAttribute('data-ground-texture', target ?? '', high);
    await expect(marker).not.toHaveAttribute('data-ground-pbr', /.*/);
    await expect(marker).not.toHaveAttribute('data-vehicle-pbr', /.*/);
    await expect(marker).not.toHaveAttribute('data-sky-hdri', /.*/);
    await expect(marker).not.toHaveAttribute('data-yard-kit', /.*/);
    await expect(marker).not.toHaveAttribute('data-cockpit-interior', /.*/);
    await expect(marker).not.toHaveAttribute('data-perspective-grade', /.*/);

    await context.setOffline(true);
    await page.reload();
    await startExercise(page, en, 'straight-reverse');
    await expect(marker).toHaveAttribute('data-ground-texture', target ?? '', high);
    await expect(marker).toHaveAttribute('data-ground-pbr', /^ktx2:[a-z0-9-]+$/, high);
    await expect(marker).toHaveAttribute('data-vehicle-pbr', 'on', high);
    await expect(marker).toHaveAttribute('data-sky-hdri', 'on', high);
    await expect(marker).toHaveAttribute('data-yard-kit', 'on', high);
    await expect(marker).toHaveAttribute('data-cockpit-interior', 'on', high);
    await expect(marker).toHaveAttribute('data-perspective-grade', 'on', high);
    expect(
      warnings.filter((w) =>
        /Ground texture|PBR ground|Sky texture|Yard kit|Vehicle reflection|Perspective grade|Shell .*interior/.test(
          w,
        ),
      ),
    ).toEqual([]);
    expect(foreign).toEqual([]);
    await expectNoFailedAttachment(page);
  },
);
