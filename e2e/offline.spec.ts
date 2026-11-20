import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { ASSET_REGISTRY } from '../src/render/asset-registry';
import { QUALITY_FLAGS } from '../src/render/quality';
import { DEFAULT_GRAPHICS } from '../src/contracts/render';
import { RUNTIME_ASSETS } from '../src/pwa/config';
import { collectThreeProblems } from './three-problems';
import { expectNoFailedAttachment, watchFailedAttachments } from './attachment-markers';
import { HIGH_WAIT_MS, PRESET_TIMEOUT_MS } from './pinned-shoot';

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

  const three = collectThreeProblems(page);
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
  const defaults = QUALITY_FLAGS[DEFAULT_GRAPHICS];
  const shells = Object.entries(ASSET_REGISTRY)
    .filter(([, { kind, flag }]) => kind === 'glb' && defaults[flag])
    .map(([stem]) => stem);
  expect(shells.length).toBeGreaterThan(0);
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
  expect(three).toEqual([]);
});

test('zooms and pans the top-down view without disturbing the controls', async ({ page }) => {
  const three = collectThreeProblems(page);
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
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
  expect(three).toEqual([]);
});

test('High graphics caches the ground, sky, yard kit and cockpit interior assets and transcoder on first use and applies them offline', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(PRESET_TIMEOUT_MS.high);
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  context.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'))
      foreign.push(url);
  });
  let offline = false;
  const three = collectThreeProblems(page);
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
  // the transcoder has no registry entry: whatever draws a KTX2 needs it
  const drawn = patterns(
    RUNTIME_ASSETS.filter(([stem]) => {
      const entry = ASSET_REGISTRY[stem];
      return entry === undefined || QUALITY_FLAGS.high[entry.flag];
    }),
  );
  expect(drawn.map(String).sort()).toEqual(
    [
      /arocs-1835-ak-interior-[\w-]+\.glb$/,
      /asphalt-albedo-[\w-]+\.ktx2$/,
      /asphalt-packed-[\w-]+\.ktx2$/,
      /basis_transcoder-[\w-]+\.js$/,
      /basis_transcoder-[\w-]+\.wasm$/,
      /concrete-albedo-[\w-]+\.ktx2$/,
      /concrete-packed-[\w-]+\.ktx2$/,
      /ground-[\w-]+\.ktx2$/,
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
  const matching = (urls: string[], file: RegExp): string[] => urls.filter((url) => file.test(url));

  // Installing does not download them: only High draws the texture, so the other presets skip the cost.
  const installed = await cached();
  for (const file of files) expect(matching(installed.precache, file), String(file)).toEqual([]);

  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
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
  await expect(marker).not.toHaveAttribute('data-ground-pbr', /.*/);
  await expect(marker).not.toHaveAttribute('data-vehicle-pbr', /.*/);
  await expect(marker).not.toHaveAttribute('data-sky-hdri', /.*/);
  await expect(marker).not.toHaveAttribute('data-yard-kit', /.*/);
  await expect(marker).not.toHaveAttribute('data-cockpit-interior', /.*/);
  await expect(marker).not.toHaveAttribute('data-perspective-grade', /.*/);

  offline = true;
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: new RegExp(`^${en.exerciseStraightReverse}`) }).click();
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
  expect(errors).toEqual([]);
  expect(three).toEqual([]);
  expect(foreign).toEqual([]);
  await expectNoFailedAttachment(page);
});
