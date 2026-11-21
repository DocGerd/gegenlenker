/**
 * Local tablet-emulation harness (not CI): drives the built app in headed Chromium on the
 * real GPU with a 1280x800 @2x touch viewport and a CPU throttle, reads the `?perf=1`
 * overlay per graphics preset and vehicle pair, and runs function checks. See docs/perf.md.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  type Backend,
  type Check,
  type Options,
  type Pair,
  type Preset,
  type Reading,
  type Run,
  MIN_FPS,
  backendProblem,
  drawnBackend,
  cellVerdict,
  checksOk,
  isIgnorableFailure,
  isSoftwareGl,
  median,
  parseOptions,
  parseOverlay,
  readingProblems,
} from './tablet-logic.ts';

// Mirrors SETTINGS_KEY in src/app/storage.ts.
const SETTINGS_KEY = 'gegenlenker.settings.v1';
const BASE_PATH = '/gegenlenker/';
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WSL_LIB = '/usr/lib/wsl/lib';
const WAKE_LOCK_KEY = '__tabletWakeLock';
const START_BUTTON = '[data-menu="yards"] button';
const SETTLE_MS = 3_000;
const SETTLE_DEADLINE_MS = 35_000;
const SERVICE_WORKER_TIMEOUT_MS = 15_000;

type Cell = { preset: Preset; pair: Pair; runs: Run[] };
type WakeLockLog = { requests: number; supported: boolean };

const USAGE = `Usage: pnpm perf:tablet [options]
  --throttle <n>     CPU slowdown factor (default 4)
  --preset <name>    low | balanced | high | all (default all)
  --runs <n>         repeats per preset and vehicle pair (default 1)
  --quick            first vehicle pair only
  --pair <t>+<tr>    one vehicle pair, <truck id>+<trailer id>
  --functional       also run the function checks
  --no-perf          skip the fps matrix (needs --functional)
  --allow-software   do not abort on a software GL renderer (results are not valid)
  --skip-build       reuse the existing dist/ (must be built with BASE_PATH=${BASE_PATH})
  --backend <name>   webgl2 | webgpu | auto: the app's ?backend= (default: the app's default)
  --lighting <mode>  day | night: the stored lighting setting (default day)`;

const wsl = existsSync(WSL_LIB);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

let teardowns: (() => Promise<void> | void)[] = [];
async function cleanup(): Promise<void> {
  const pending = teardowns.reverse();
  teardowns = [];
  for (const fn of pending) {
    try {
      await fn();
    } catch (e) {
      console.error(`cleanup: ${message(e)}`);
    }
  }
}
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(code));
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no free port');
  return address.port;
}

/** `pnpm` spawns vite as a child, so signal the whole process group; it may already be gone. */
function stopPreview(server: ChildProcess): void {
  if (server.pid === undefined) return;
  try {
    process.kill(-server.pid);
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ESRCH')) throw e;
  }
}

async function startPreview(skipBuild: boolean): Promise<string> {
  const env = { ...process.env, BASE_PATH };
  let outDir = 'dist';
  if (!skipBuild) {
    outDir = mkdtempSync(join(tmpdir(), 'gegenlenker-tablet-'));
    teardowns.push(() => {
      rmSync(outDir, { recursive: true, force: true });
    });
    const build = spawnSync('pnpm', ['build', '--outDir', outDir], {
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (build.status !== 0) throw new Error('pnpm build failed');
  }
  const port = await freePort();
  const server = spawn(
    'pnpm',
    ['preview', '--outDir', outDir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { env, stdio: ['ignore', 'ignore', 'inherit'], detached: true },
  );
  teardowns.push(() => {
    stopPreview(server);
  });
  // Safety net for exits that skip the async cleanup (uncaught errors).
  process.once('exit', () => {
    stopPreview(server);
  });
  const base = `http://127.0.0.1:${String(port)}${BASE_PATH}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('pnpm preview exited early');
    const up = await fetch(base).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return base;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('pnpm preview did not come up');
}

function launch(backend: Backend | null): Promise<Browser> {
  // On WSL the GPU needs the d3d12 Mesa driver and ANGLE on desktop GL; elsewhere Chromium picks its default.
  const args = ['--ignore-gpu-blocklist', '--enable-gpu'];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  if (backend === 'webgpu' || backend === 'auto') args.push('--enable-unsafe-webgpu');
  if (wsl) {
    args.push('--use-gl=angle', '--use-angle=gl');
    // WSL has no hardware Vulkan driver: Dawn's OpenGL ES backend is its only hardware adapter.
    if (backend === 'webgpu' || backend === 'auto') args.push('--use-webgpu-adapter=opengles');
    env['GALLIUM_DRIVER'] = 'd3d12';
    env['LD_LIBRARY_PATH'] = [WSL_LIB, env['LD_LIBRARY_PATH']].filter(Boolean).join(':');
  }
  // Our own signal handlers close the browser together with the preview.
  return chromium.launch({
    headless: false,
    args,
    env,
    timeout: 60_000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

type Fixture = { context: BrowserContext; page: Page; errors: string[]; failed: string[] };

async function tabletContext(browser: Browser, settings: Record<string, string>): Promise<Fixture> {
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
  const failed: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const failure = r.failure()?.errorText ?? 'failed';
    if (!isIgnorableFailure(r.url(), failure)) failed.push(`${failure} ${r.url()}`);
  });
  return { context, page, errors, failed };
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
  return parseOverlay(text);
}

async function measure(
  browser: Browser,
  base: string,
  opts: Options,
  preset: Preset,
  [truckId, trailerId]: Pair,
  traces: TraceSink,
  index: number,
): Promise<Run> {
  const { context, page, errors, failed } = await tabletContext(browser, {
    graphics: preset,
    lighting: opts.lighting,
    truckId,
    trailerId,
  });
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle });
    await page.goto(`${base}?perf=1${opts.backend === null ? '' : `&backend=${opts.backend}`}`);
    await page.locator(START_BUTTON).first().click();
    await page.locator('.hud-mirror:not([hidden])').first().waitFor({ timeout: 60_000 });
    // Four-view layout, then drive forward.
    await page.keyboard.press('4');
    await page.keyboard.press('w');
    await page.keyboard.press('w');
    await page
      .waitForFunction(
        () => parseFloat(document.querySelector('[data-hud="speed"]')?.textContent ?? '') > 0,
        null,
        { timeout: 15_000 },
      )
      .catch(() => {
        throw new Error('the vehicle did not move after the key presses');
      });
    await page.waitForFunction(
      () => [...document.querySelectorAll('.mono')].some((e) => e.textContent.includes(' fps')),
      null,
      { timeout: 30_000 },
    );
    // The governor may still step the resolution down: wait until the scale holds.
    let last = await readOverlay(page);
    let since = Date.now();
    const deadline = Date.now() + SETTLE_DEADLINE_MS;
    while (Date.now() < deadline && Date.now() - since < SETTLE_MS) {
      await page.waitForTimeout(250);
      const next = await readOverlay(page);
      if (next && last && next.scale !== last.scale) since = Date.now();
      last = next ?? last;
    }
    if (Date.now() - since < SETTLE_MS) errors.push('resolution scale did not settle');
    const samples: Reading[] = [];
    for (const end = Date.now() + 12_000; Date.now() < end;) {
      await page.waitForTimeout(500);
      const s = await readOverlay(page);
      if (s) samples.push(s);
    }
    const final = samples.at(-1);
    if (!final) throw new Error('perf overlay produced no samples');
    errors.push(...failed.map((f) => `request failed: ${f}`));
    errors.push(...samples.flatMap(readingProblems));
    const wrongBackend = backendProblem(opts.backend, final.gl);
    if (wrongBackend !== null) errors.push(wrongBackend);
    if (final.scale < 1) {
      const trace = await page.evaluate(() => {
        const governor = Reflect.get(window, '__governor') as { trace: () => unknown } | undefined;
        return governor?.trace() ?? null;
      });
      const label = `${preset}-${truckId}-${trailerId}-run${String(index + 1)}`;
      const { throttle, lighting, backend } = opts;
      const path = traces.write(label, {
        preset,
        pair: [truckId, trailerId],
        throttle,
        lighting,
        backend,
        reading: final,
        trace,
      });
      console.log(`${label}: ended at scale ${final.scale.toFixed(2)}, governor trace ${path}`);
    }
    return {
      reading: {
        fps: median(samples.map((s) => s.fps)),
        p95: Math.max(...samples.map((s) => s.p95)),
        scale: final.scale,
        calls: median(samples.map((s) => s.calls)),
        shadow: median(samples.map((s) => s.shadow)),
        gl: final.gl,
      },
      errors: [...new Set(errors)],
    };
  } finally {
    await context.close();
  }
}

/** Governor traces of runs that ended below full resolution, kept in a directory that outlives the harness. */
type TraceSink = { write: (label: string, content: unknown) => string };

function traceSink(): TraceSink {
  let dir: string | null = null;
  return {
    write(label, content) {
      dir ??= mkdtempSync(join(tmpdir(), 'gegenlenker-governor-'));
      const path = join(dir, `${label}.json`);
      writeFileSync(path, JSON.stringify(content));
      return path;
    },
  };
}

async function perfMatrix(browser: Browser, base: string, opts: Options): Promise<Cell[]> {
  const cells: Cell[] = [];
  const traces = traceSink();
  for (const preset of opts.presets) {
    for (const pair of opts.pairs) {
      const cell: Cell = { preset, pair, runs: [] };
      for (let i = 0; i < opts.runs; i++) {
        cell.runs.push(await measure(browser, base, opts, preset, pair, traces, i));
      }
      cells.push(cell);
      const { passed, total } = cellVerdict(cell.runs);
      console.log(`${preset} ${pair.join(' + ')}: ${String(passed)}/${String(total)} passed`);
    }
  }
  return cells;
}

function printMatrix(cells: Cell[], opts: Options): boolean {
  const rows = cells.map((c) => {
    const readings = c.runs.map((r) => r.reading);
    const { passed, total, ok } = cellVerdict(c.runs);
    return [
      c.preset,
      c.pair.join(' + '),
      [...new Set(readings.map((r) => drawnBackend(r.gl)))].join('/'),
      String(Math.min(...readings.map((r) => r.fps))),
      Math.max(...readings.map((r) => r.p95)).toFixed(1),
      Math.min(...readings.map((r) => r.scale)).toFixed(2),
      String(median(readings.map((r) => r.calls))),
      `${String(passed)}/${String(total)}`,
      ok ? 'ok' : 'FAIL',
    ];
  });
  const head = ['preset', 'vehicles', 'backend', 'fps', 'p95 ms', 'scale', 'calls', 'passed', ''];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)));
  const line = (r: string[]): string =>
    r
      .map((v, i) => v.padEnd(width[i] ?? 0))
      .join('  ')
      .trimEnd();
  console.log(
    `\nthrottle ${String(opts.throttle)}x; bar: >= ${String(MIN_FPS)} fps at scale 1.00, no errors (worst run per cell)`,
  );
  console.log([line(head), ...rows.map(line)].join('\n'));
  for (const c of cells) {
    for (const e of new Set(c.runs.flatMap((r) => r.errors))) console.log(`${c.preset}: ${e}`);
  }
  return cells.every((c) => cellVerdict(c.runs).ok);
}

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

async function checkOffline({ context, page }: Fixture): Promise<string> {
  await page.evaluate(
    (ms) =>
      Promise.race([
        navigator.serviceWorker.ready.then(() => undefined),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('service worker not ready'));
          }, ms);
        }),
      ]),
    SERVICE_WORKER_TIMEOUT_MS,
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await startDrive(page);
  if ((await page.locator('canvas').count()) === 0) throw new Error('no canvas while offline');
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
      const problems = [...fixture.errors, ...fixture.failed.map((f) => `request failed: ${f}`)];
      if (problems.length > 0) throw new Error([...new Set(problems)].join('; '));
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
  const opts = parseOptions(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return true;
  }
  const base = await startPreview(opts.skipBuild);
  const browser = await launch(opts.backend);
  teardowns.push(() => browser.close());
  const probe = await browser.newPage();
  const renderer = await glRenderer(probe);
  await probe.close();
  console.log(`GL renderer: ${renderer}`);
  if (isSoftwareGl(renderer)) {
    if (!opts.allowSoftware) {
      throw new Error(
        `no hardware GL (${renderer}): results would be invalid; --allow-software overrides`,
      );
    }
    console.warn('warning: software GL, results are not valid');
  }
  let ok = true;
  if (opts.perf) ok = printMatrix(await perfMatrix(browser, base, opts), opts);
  if (opts.functional) ok = checksOk(await functionalChecks(browser, base)) && ok;
  return ok;
}

if (import.meta.main) {
  try {
    process.exitCode = (await main()) ? 0 : 1;
  } catch (e) {
    console.error(message(e));
    process.exitCode = 2;
  } finally {
    await cleanup();
  }
}
