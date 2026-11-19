/**
 * Local tablet-emulation harness (not CI): drives the built app in headed Chromium on the
 * real GPU with a 1280x800 @2x touch viewport and a CPU throttle, reads the `?perf=1`
 * overlay per graphics preset and vehicle pair, and runs function checks. See docs/perf.md.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Mirrors SETTINGS_KEY in src/app/storage.ts.
const SETTINGS_KEY = 'gegenlenker.settings.v1';
const BASE_PATH = '/gegenlenker/';
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PRESETS = ['low', 'balanced', 'high'] as const;
const PAIRS = [
  ['man-le-18-280', 'krone-azw-18'],
  ['man-le-18-280', 'hueffermann-hpa-24-81-l'],
  ['arocs-1835-ak', 'krone-azw-18'],
  ['arocs-1835-ak', 'hueffermann-hpa-24-81-l'],
] as const;
const MIN_FPS = 58;
const SOFTWARE_GL = /SwiftShader|llvmpipe|Software/i;
const WSL_LIB = '/usr/lib/wsl/lib';
const WAKE_LOCK_KEY = '__tabletWakeLock';
const START_BUTTON = '[data-menu="yards"] button';

type Preset = (typeof PRESETS)[number];
type Pair = (typeof PAIRS)[number];
type Reading = { fps: number; p95: number; scale: number; calls: number; gl: string };
type Cell = { preset: Preset; pair: Pair; runs: Reading[]; errors: string[]; passed: number };
type Check = { name: string; status: 'pass' | 'fail' | 'skip'; detail: string };
type WakeLockLog = { requests: number; supported: boolean };

const { values } = parseArgs({
  options: {
    throttle: { type: 'string', default: '4' },
    preset: { type: 'string', default: 'all' },
    runs: { type: 'string', default: '1' },
    quick: { type: 'boolean', default: false },
    functional: { type: 'boolean', default: false },
    'no-perf': { type: 'boolean', default: false },
    'allow-software': { type: 'boolean', default: false },
    'skip-build': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

const USAGE = `Usage: pnpm perf:tablet [options]
  --throttle <n>     CPU slowdown factor (default 4)
  --preset <name>    low | balanced | high | all (default all)
  --runs <n>         repeats per preset and vehicle pair (default 1)
  --quick            first vehicle pair only
  --functional       also run the function checks
  --no-perf          skip the fps matrix (use with --functional)
  --allow-software   do not abort on a software GL renderer (results are not valid)
  --skip-build       reuse the existing dist/ (must be built with BASE_PATH=${BASE_PATH})`;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const positive = (name: string, raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be an integer >= 1`);
  return value;
};
const throttle = positive('throttle', values.throttle);
const runs = positive('runs', values.runs);
const presets = PRESETS.filter((p) => values.preset === 'all' || values.preset === p);
if (presets.length === 0) throw new Error(`--preset must be one of ${PRESETS.join(', ')}, all`);
const pairs = values.quick ? PAIRS.slice(0, 1) : PAIRS;
const wsl = existsSync(WSL_LIB);

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no free port');
  return address.port;
}

async function startPreview(): Promise<{ base: string; server: ChildProcess }> {
  const env = { ...process.env, BASE_PATH };
  if (!values['skip-build']) {
    const build = spawnSync('pnpm', ['build'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    if (build.status !== 0) throw new Error('pnpm build failed');
  }
  const port = await freePort();
  const server = spawn(
    'pnpm',
    ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { env, stdio: ['ignore', 'ignore', 'inherit'], detached: true },
  );
  const base = `http://127.0.0.1:${String(port)}${BASE_PATH}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('pnpm preview exited early');
    const up = await fetch(base).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return { base, server };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopPreview(server);
  throw new Error('pnpm preview did not come up');
}

/** `pnpm` spawns vite as a child, so signal the whole process group. */
function stopPreview(server: ChildProcess): void {
  if (server.pid !== undefined) process.kill(-server.pid);
}

function launch(): Promise<Browser> {
  // On WSL the GPU needs the d3d12 Mesa driver and ANGLE on desktop GL; elsewhere Chromium picks its default.
  const args = ['--ignore-gpu-blocklist', '--enable-gpu'];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  if (wsl) {
    args.push('--use-gl=angle', '--use-angle=gl');
    env['GALLIUM_DRIVER'] = 'd3d12';
    env['LD_LIBRARY_PATH'] = [WSL_LIB, env['LD_LIBRARY_PATH']].filter(Boolean).join(':');
  }
  return chromium.launch({ headless: false, args, env, timeout: 60_000 });
}

async function tabletContext(
  browser: Browser,
  settings: Record<string, string>,
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: USER_AGENT,
    locale: 'en-US',
    serviceWorkers: 'allow',
  });
  await context.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [SETTINGS_KEY, JSON.stringify({ version: 1, language: 'en', ...settings })] as const,
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { context, page, errors };
}

function glRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'no WebGL2';
  });
}

async function startDrive(page: Page): Promise<void> {
  await page.locator(START_BUTTON).first().click();
  await page.locator('.ctl-wheel').waitFor();
}

async function readOverlay(page: Page): Promise<Reading | null> {
  const text = await page.evaluate(
    () =>
      [...document.querySelectorAll('.mono')]
        .map((e) => e.textContent)
        .find((t) => t.includes(' fps')) ?? '',
  );
  const m = /(\d+) fps\s+p95 ([\d.]+) ms\s+scale ([\d.]+)\s+calls (\d+)\n(.*)/.exec(text);
  const [, fps, p95, scale, calls, gl] = m ?? [];
  return fps && p95 && scale && calls && gl
    ? { fps: +fps, p95: +p95, scale: +scale, calls: +calls, gl }
    : null;
}

async function measure(
  browser: Browser,
  base: string,
  preset: Preset,
  [truckId, trailerId]: Pair,
): Promise<{ reading: Reading; errors: string[] }> {
  const { context, page, errors } = await tabletContext(browser, {
    graphics: preset,
    truckId,
    trailerId,
  });
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.goto(`${base}?perf=1`);
    await page.locator(START_BUTTON).first().click();
    await page.locator('.hud-mirror:not([hidden])').first().waitFor({ timeout: 60_000 });
    // Four-view layout, then drive forward.
    await page.keyboard.press('4');
    await page.keyboard.press('w');
    await page.keyboard.press('w');
    await page.waitForFunction(
      () => [...document.querySelectorAll('.mono')].some((e) => e.textContent.includes(' fps')),
      null,
      { timeout: 30_000 },
    );
    // The governor may still step the resolution down: wait until the scale holds for 3 s.
    let last = await readOverlay(page);
    let since = Date.now();
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline && Date.now() - since < 3_000) {
      await page.waitForTimeout(250);
      const next = await readOverlay(page);
      if (next && last && next.scale !== last.scale) since = Date.now();
      last = next ?? last;
    }
    const samples: Reading[] = [];
    for (const end = Date.now() + 12_000; Date.now() < end;) {
      await page.waitForTimeout(500);
      const s = await readOverlay(page);
      if (s) samples.push(s);
    }
    const final = samples.at(-1);
    if (!final) throw new Error('perf overlay produced no samples');
    return {
      reading: {
        fps: median(samples.map((s) => s.fps)),
        p95: Math.max(...samples.map((s) => s.p95)),
        scale: final.scale,
        calls: median(samples.map((s) => s.calls)),
        gl: final.gl,
      },
      errors,
    };
  } finally {
    await context.close();
  }
}

const meetsBar = (r: Reading): boolean => r.fps >= MIN_FPS && r.scale >= 1;

async function perfMatrix(browser: Browser, base: string): Promise<Cell[]> {
  const cells: Cell[] = [];
  for (const preset of presets) {
    for (const pair of pairs) {
      const cell: Cell = { preset, pair, runs: [], errors: [], passed: 0 };
      for (let i = 0; i < runs; i++) {
        const { reading, errors } = await measure(browser, base, preset, pair);
        cell.runs.push(reading);
        cell.errors.push(...errors);
        if (meetsBar(reading) && errors.length === 0) cell.passed++;
      }
      cells.push(cell);
      console.log(`${preset} ${pair.join(' + ')}: ${String(cell.passed)}/${String(runs)} passed`);
    }
  }
  return cells;
}

function printMatrix(cells: Cell[]): boolean {
  const rows = cells.map((c) => [
    c.preset,
    c.pair.join(' + '),
    String(Math.min(...c.runs.map((r) => r.fps))),
    Math.max(...c.runs.map((r) => r.p95)).toFixed(1),
    Math.min(...c.runs.map((r) => r.scale)).toFixed(2),
    String(median(c.runs.map((r) => r.calls))),
    `${String(c.passed)}/${String(c.runs.length)}`,
    c.passed === c.runs.length ? 'ok' : 'FAIL',
  ]);
  const head = ['preset', 'vehicles', 'fps', 'p95 ms', 'scale', 'calls', 'passed', ''];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)));
  const line = (r: string[]): string =>
    r
      .map((v, i) => v.padEnd(width[i] ?? 0))
      .join('  ')
      .trimEnd();
  console.log(
    `\nthrottle ${String(throttle)}x; bar: >= ${String(MIN_FPS)} fps at scale 1.00, no console errors (worst run per cell)`,
  );
  console.log([line(head), ...rows.map(line)].join('\n'));
  for (const c of cells) for (const e of new Set(c.errors)) console.log(`${c.preset}: ${e}`);
  return cells.every((c) => c.passed === c.runs.length);
}

type Fixture = { context: BrowserContext; page: Page; errors: string[] };

/** A fresh tablet context on the menu; `init` runs in the page before the app. */
async function menuContext(
  browser: Browser,
  base: string,
  init?: (key: string) => void,
): Promise<Fixture> {
  const fixture = await tabletContext(browser, { graphics: 'balanced' });
  if (init) await fixture.context.addInitScript(init, WAKE_LOCK_KEY);
  await fixture.page.goto(base);
  return fixture;
}

async function checkOffline({ context, page, errors }: Fixture): Promise<string> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await startDrive(page);
  if ((await page.locator('canvas').count()) === 0) throw new Error('no canvas while offline');
  if (errors.length > 0) throw new Error(errors.join('; '));
  return 'service worker controls the page; menu and drive load offline';
}

async function checkHistoryBack({ page }: Fixture): Promise<string> {
  await startDrive(page);
  await page.evaluate(() => {
    history.back();
  });
  await page.getByText('Paused', { exact: true }).first().waitFor({ timeout: 10_000 });
  if (page.url().startsWith('about:')) throw new Error('back left the app instead of pausing');
  await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
  await page.locator(START_BUTTON).first().waitFor({ timeout: 10_000 });
  return 'back from the drive pauses; Menu returns to the menu';
}

async function checkWakeLock({ page }: Fixture): Promise<string> {
  await startDrive(page);
  const log = await page.evaluate((key) => Reflect.get(window, key) as WakeLockLog, WAKE_LOCK_KEY);
  if (!log.supported) return 'skip: wake lock API unsupported';
  await page.waitForFunction(
    (key) => (Reflect.get(window, key) as WakeLockLog).requests > 0,
    WAKE_LOCK_KEY,
    { timeout: 5_000 },
  );
  return 'requested while driving';
}

async function checkTwoThumbs({ context, page }: Fixture): Promise<string> {
  await startDrive(page);
  const cdp = await context.newCDPSession(page);
  const wheel = await page.locator('.ctl-wheel').boundingBox();
  const lever = await page.locator('.ctl-lever').boundingBox();
  if (!wheel || !lever) throw new Error('controls have no box');
  const centre = { x: wheel.x + wheel.width / 2, y: wheel.y + wheel.height / 2 };
  const radius = wheel.width * 0.4;
  const wheelAt = (a: number) => ({
    x: centre.x + radius * Math.cos(a),
    y: centre.y + radius * Math.sin(a),
    id: 1,
  });
  const leverAt = (f: number) => ({
    x: lever.x + lever.width / 2,
    y: lever.y + lever.height * (1 - f),
    id: 2,
  });
  const read = () =>
    page.evaluate(() => ({
      lever: document
        .querySelector<HTMLElement>('[data-ctl="lever"]')
        ?.style.getPropertyValue('--lever'),
      wheel: document.querySelector<HTMLElement>('[data-ctl="wheel-art"]')?.style.transform,
    }));
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: { x: number; y: number; id: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const before = await read();
  await send('touchStart', [wheelAt(-Math.PI / 2), leverAt(0.05)]);
  for (let i = 1; i <= 12; i++) {
    await send('touchMove', [wheelAt(-Math.PI / 2 + i * 0.1), leverAt(0.05 + i * 0.04)]);
  }
  const during = await read();
  await send('touchEnd', []);
  if (during.wheel === before.wheel) throw new Error('wheel did not turn');
  if (during.lever === before.lever) throw new Error('lever did not move');
  return 'wheel and lever respond to simultaneous touches';
}

async function functionalChecks(browser: Browser, base: string): Promise<Check[]> {
  const wakeLockHook = (key: string): void => {
    const log: WakeLockLog = { requests: 0, supported: 'wakeLock' in navigator };
    Reflect.set(window, key, log);
    if (!log.supported) return;
    const request = navigator.wakeLock.request.bind(navigator.wakeLock);
    navigator.wakeLock.request = (type) => {
      log.requests++;
      return request(type);
    };
  };
  const specs: [string, (f: Fixture) => Promise<string>, ((key: string) => void)?][] = [
    ['offline', checkOffline],
    ['history-back', checkHistoryBack],
    ['wake-lock', checkWakeLock, wakeLockHook],
    ['two-thumb-touch', checkTwoThumbs],
  ];
  const checks: Check[] = [];
  for (const [name, run, init] of specs) {
    const fixture = await menuContext(browser, base, init);
    try {
      const detail = await run(fixture);
      checks.push({ name, status: detail.startsWith('skip:') ? 'skip' : 'pass', detail });
    } catch (e) {
      checks.push({ name, status: 'fail', detail: message(e) });
    } finally {
      await fixture.context.close();
    }
  }
  console.log('\nfunction checks');
  for (const c of checks) {
    console.log(`  ${c.status.toUpperCase().padEnd(4)}  ${c.name.padEnd(16)}${c.detail}`);
  }
  return checks;
}

async function main(): Promise<boolean> {
  const { base, server } = await startPreview();
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const probe = await browser.newPage();
    const renderer = await glRenderer(probe);
    await probe.close();
    console.log(`GL renderer: ${renderer}`);
    if (SOFTWARE_GL.test(renderer) || renderer === 'no WebGL2') {
      if (!values['allow-software']) {
        throw new Error(
          `no hardware GL (${renderer}): results would be invalid; --allow-software overrides`,
        );
      }
      console.warn('warning: software GL, results are not valid');
    }
    let ok = true;
    if (!values['no-perf']) ok = printMatrix(await perfMatrix(browser, base));
    if (values.functional) {
      const checks = await functionalChecks(browser, base);
      ok = checks.every((c) => c.status !== 'fail') && ok;
    }
    return ok;
  } finally {
    await browser?.close();
    stopPreview(server);
  }
}

try {
  process.exitCode = (await main()) ? 0 : 1;
} catch (e) {
  console.error(message(e));
  process.exitCode = 2;
}
