import type { Page } from '@playwright/test';
import type { LightingMode, ScenePaletteKey } from '../src/contracts/render';
import { ATTACHMENTS, type Attachment } from '../src/render/asset-registry.ts';
import { QUALITY_FLAGS } from '../src/render/quality.ts';
import { pageMessages, startEntry, type MenuEntry } from './menu-flow.ts';

// Imported by scripts/shoot-views.mjs through Node's type stripping: no enums, and runtime imports
// carry their `.ts` extension and reach only modules that import nothing at runtime.

export type Preset = 'low' | 'balanced' | 'high';
/** What a drive is rendered with: the stored `graphics` and `lighting` settings; `theme` is only stored when given. */
export type RenderConfig = {
  readonly preset: Preset;
  readonly lighting: LightingMode;
  readonly theme?: 'system' | 'light' | 'dark';
};
export type Shot =
  | 'cockpit'
  | 'mirrorLeft'
  | 'mirrorRight'
  | 'wideLeft'
  | 'wideRight'
  | 'front'
  | 'follow'
  | 'yard'
  | 'chase';

/**
 * Tag of the tests that are slow on software GL: they draw Balanced or High, compare presets, or
 * step many frames. Playwright shards by test count, so CI runs them apart from the rest and from
 * the layout spec, whose tests are many and alike (`.github/workflows/ci.yml`).
 */
export const HEAVY = '@heavy';
/** `HEAVY` for a test that drives `preset` unless that is Low, else no tag. */
export const heavyAt = (preset: Preset): { tag?: string } =>
  preset === 'low' ? {} : { tag: HEAVY };
/**
 * Tag of the tests that cost several times a `HEAVY` one at High, so each runs apart from the
 * `HEAVY` shards (`.github/workflows/ci.yml`): a shard cut by test count would otherwise stack them.
 */
export const SLOW = '@slow';
/** `SLOW` for a test that drives High at a cost beyond `HEAVY`, else `heavyAt(preset)`. */
export const slowAt = (preset: Preset): { tag?: string } =>
  preset === 'high' ? { tag: SLOW } : heavyAt(preset);
/** Wall-clock bound for a test that drives one preset; High loads the most and draws slowest on software GL. */
export const PRESET_TIMEOUT_MS: Readonly<Record<Preset, number>> = {
  low: 90_000,
  balanced: 150_000,
  high: 360_000,
};
/** How long a web-first wait for a High first-load marker may take on software GL, against the 30 s default. */
export const HIGH_WAIT_MS = 60_000;

export const SETTINGS_KEY = 'gegenlenker.settings.v1';
const FRAME_MS = 16;
/** Frames stepped after the scene is ready, so every lazily built resource is in place. */
const SETTLE_FRAMES = 30;
/** Wall-clock bound on each phase of `settle`, so a preset that never readies fails by name, not by the test timeout; High loads its KTX2 files one after another. */
export const SETTLE_DEADLINE_MS: Readonly<Record<Preset, number>> = {
  low: 30_000,
  balanced: 30_000,
  high: 120_000,
};
/**
 * A test timeout that outlasts the worst case of `settles` calls to `settle` (two phases each),
 * so a preset that never readies fails by name first. `workMs` is everything besides settling.
 */
export const timeoutWithSettles = (
  preset: Preset,
  settles: number,
  workMs: number = PRESET_TIMEOUT_MS[preset],
): number => workMs + settles * 2 * SETTLE_DEADLINE_MS[preset];
/**
 * The `settle` deadlines on a `?backend=webgpu` page: SwiftShader builds every pipeline on the CPU,
 * and High a sequence of them, so they outlast the WebGL ones (`SETTLE_DEADLINE_MS`).
 */
export const WEBGPU_SETTLE_DEADLINE_MS: Readonly<Record<Preset, number>> = {
  low: 60_000,
  balanced: 90_000,
  high: 240_000,
};
/** Consecutive frames the framing input must hold before a shot, so a late chrome measurement cannot move it. */
const STABLE_FRAMES = 5;
const HIDE_ID = 'pinned-shoot-bare';
/**
 * A drawn pane has more distinct colours than this; a blank pane has one. Below the flat top-down
 * view at the start, the sparsest drawn pane, with a margin for Chromium's new headless mode
 * (`scripts/shoot-views.mjs --backend webgpu`), which draws it with fewer. A text notice is not
 * caught by a colour count: its anti-aliased glyphs give more colours than that view.
 */
export const MIN_DRAWN_COLOURS = 40;

/** Set once the renderer is ready and removed on a loss, so a settle after a loss waits for the new one. */
const BACKEND_READY = (v: string): boolean => v !== '';

/** Per `<html>` marker, whether its value says the attachment is in place. */
export type MarkerChecks = Readonly<Record<string, (value: string) => boolean>>;

/** The `<html>` markers whose values say `preset`'s asynchronous attachments are in place; a shot before they land would differ. */
export function readyMarkers(preset: Preset, overrides: MarkerChecks = {}): MarkerChecks {
  const flags = QUALITY_FLAGS[preset];
  const drawn = Object.values<Attachment>(ATTACHMENTS).filter((a) =>
    a.flags.every((f) => flags[f]),
  );
  return {
    'data-render-backend': BACKEND_READY,
    ...Object.fromEntries(drawn.map((a) => [a.marker, a.ready])),
    ...overrides,
  };
}

const BOX: Readonly<Record<Shot, string>> = {
  cockpit: '[data-hud="cockpit"]',
  mirrorLeft: '[data-hud="mirrorLeft"]',
  mirrorRight: '[data-hud="mirrorRight"]',
  wideLeft: '[data-hud="wideLeft"]',
  wideRight: '[data-hud="wideRight"]',
  front: '[data-hud="front"]',
  follow: '[data-hud="topDown"]',
  yard: '[data-hud="topDown"]',
  chase: '[data-hud="topDown"]',
};
const VIEW_KEY: Partial<Record<Shot, string>> = { follow: 'f', yard: 'y', chase: 'o' };

/** The pages started on `?backend=webgpu`: their frames are only drawn once the GPU has run them. */
const webgpuPages = new WeakSet<Page>();

/**
 * Runs in the page before the app: keeps every GPUDevice the app requests, so `step` can wait for
 * the GPU. SwiftShader runs submitted work asynchronously, and a stepped clock outruns it.
 */
function captureGpuDevices(): void {
  const devices: GPUDevice[] = [];
  Object.assign(window, { gpuDevices: devices });
  const request = Object.getOwnPropertyDescriptor(GPUAdapter.prototype, 'requestDevice')?.value as
    GPUAdapter['requestDevice'] | undefined;
  if (request === undefined) throw new Error('no requestDevice to wrap');
  GPUAdapter.prototype.requestDevice = async function (
    this: GPUAdapter,
    ...args: Parameters<GPUAdapter['requestDevice']>
  ): Promise<GPUDevice> {
    const device = await request.apply(this, args);
    devices.push(device);
    return device;
  };
}

/** Runs `frames` frames of the pinned clock; on a WebGPU page one at a time, each awaiting the GPU. */
export async function step(page: Page, frames: number): Promise<void> {
  if (!webgpuPages.has(page)) {
    await page.clock.runFor(frames * FRAME_MS);
    return;
  }
  for (let i = 0; i < frames; i++) {
    await page.clock.runFor(FRAME_MS);
    await page.evaluate(() =>
      Promise.all(
        (window as unknown as { gpuDevices: GPUDevice[] }).gpuDevices.map((d) =>
          // a lost device never finishes its queue; the app falls back and the spec reads that
          d.queue.onSubmittedWorkDone().catch(() => undefined),
        ),
      ).then(() => undefined),
    );
  }
}

/**
 * Runs in the page. ANGLE resolves a multisample target inside its render pass while that pass is
 * open and with a separate command once it has closed; SwiftShader rounds the two differently and
 * GPU-process timing picks one per frame (#203). A readback before each blit closes the pass.
 * Marks `<html>` with `data-resolve-pinned` once a readback succeeds.
 */
function pinResolvePath(): void {
  const proto = WebGL2RenderingContext.prototype;
  const blit = Object.getOwnPropertyDescriptor(proto, 'blitFramebuffer')?.value as
    WebGL2RenderingContext['blitFramebuffer'] | undefined;
  if (blit === undefined) throw new Error('no blitFramebuffer to pin');
  const targets = new WeakMap<WebGL2RenderingContext, WebGLFramebuffer>();
  const pixel = new Uint8Array(4);
  let pinned = false;
  const target = (gl: WebGL2RenderingContext): WebGLFramebuffer => {
    const known = targets.get(gl);
    // a restored context no longer knows the old framebuffer
    if (known !== undefined && gl.isFramebuffer(known)) return known;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    const boundTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const boundDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, boundDraw);
    gl.bindTexture(gl.TEXTURE_2D, boundTexture);
    targets.set(gl, framebuffer);
    return framebuffer;
  };
  proto.blitFramebuffer = function (
    this: WebGL2RenderingContext,
    ...args: Parameters<WebGL2RenderingContext['blitFramebuffer']>
  ): void {
    if (!this.isContextLost()) {
      const read = this.getParameter(this.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const pack = this.getParameter(this.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
      this.bindFramebuffer(this.READ_FRAMEBUFFER, target(this));
      this.bindBuffer(this.PIXEL_PACK_BUFFER, null);
      this.readPixels(0, 0, 1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
      if (!pinned && this.getError() === this.NO_ERROR) {
        pinned = true;
        document.documentElement.dataset['resolvePinned'] = '';
      }
      this.bindBuffer(this.PIXEL_PACK_BUFFER, pack);
      this.bindFramebuffer(this.READ_FRAMEBUFFER, read);
    }
    blit.apply(this, args);
  };
}

/**
 * Opens a standstill drive of the menu `entry` on `config` with `performance.now`, timers and rAF frozen,
 * so the resolution governor and the sim only move when stepped, and pins the multisample resolve
 * to one path. Call on a fresh page; `search` is the app URL's query (`?backend=webgpu`);
 * `deadlineMs` bounds each phase of the `settle` that waits for the preset; `overrides` replace the
 * ready check of a marker (a feature the test fails on purpose).
 */
export async function startPinnedDrive(
  page: Page,
  { preset, lighting, theme }: RenderConfig,
  entry: MenuEntry,
  search = '',
  deadlineMs?: number,
  overrides?: MarkerChecks,
): Promise<void> {
  if (new URLSearchParams(search).get('backend') === 'webgpu') {
    webgpuPages.add(page);
    await page.addInitScript(captureGpuDevices);
  }
  await page.addInitScript(pinResolvePath);
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    SETTINGS_KEY,
    JSON.stringify({
      version: 1,
      graphics: preset,
      lighting,
      topDown: 'follow',
      theme,
      ...(entry.role === 'einweiser' ? { einweiserPreview: true } : {}),
    }),
  ] as const);
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto(`./${withFramingFlag(search)}`);
  await startEntry(page, await pageMessages(page), entry);
  await (
    entry.role === 'einweiser'
      ? page.locator('.drive[data-role="einweiser"]')
      : page.locator('.hud-mirror:not([hidden])').nth(1)
  ).waitFor();
  await settle(page, preset, deadlineMs, overrides);
  const [backend, pinned] = await page.evaluate(() => {
    const html = document.documentElement;
    return [html.getAttribute('data-render-backend'), html.getAttribute('data-resolve-pinned')];
  });
  if (backend === 'webgl2' && pinned === null)
    throw new Error('the multisample resolve is not pinned');
}

/** `search` with `?framing=1`, which exposes the drawn vehicle's screen box as `data-vehicle-box`. */
function withFramingFlag(search: string): string {
  const params = new URLSearchParams(search);
  params.set('framing', '1');
  return `?${params.toString()}`;
}

/** Whether `preset`'s attachments are in place, read from `<html>`; a shot before they land would differ. */
export async function attachmentsReady(page: Page, preset: Preset): Promise<boolean> {
  return (await attachments(page, preset)).ready;
}

async function attachments(
  page: Page,
  preset: Preset,
  overrides?: MarkerChecks,
): Promise<{ ready: boolean; values: (string | null)[] }> {
  const want = readyMarkers(preset, overrides);
  const values = await page.evaluate((names) => {
    const html = document.documentElement;
    return names.map((n) => html.getAttribute(n));
  }, Object.keys(want));
  return { ready: Object.values(want).every((ok, j) => ok(values[j] ?? '')), values };
}

/** The resolution governor's applied scale: the canvas backing width over its CSS width (DPR 1). */
export function renderScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas === null) throw new Error('no canvas');
    const scale = canvas.width / canvas.clientWidth;
    if (!Number.isFinite(scale)) throw new Error('canvas has no size');
    return Math.round(scale * 1000) / 1000;
  });
}

/**
 * The vehicle's screen box without the sim step, and the render scale, so it reads the same while the
 * sim stands still; null until drawn. The chase view projects no box, so there it is the scale alone.
 */
async function framingBox(page: Page): Promise<string | null> {
  if ((await page.locator('[data-view="chase"][aria-pressed="true"]').count()) > 0) {
    return JSON.stringify([await renderScale(page)]);
  }
  const raw = await page.locator('.drive').getAttribute('data-vehicle-box', { timeout: 5_000 });
  if (raw === null) return null;
  const { left, top, right, bottom } = JSON.parse(raw) as Record<string, number>;
  return JSON.stringify([left, top, right, bottom, await renderScale(page)]);
}

/**
 * Steps the pinned clock until `preset`'s attachments are in place, fonts are loaded and the follow
 * framing (derived from the measured HUD chrome) has held for several frames, then settles. Throws
 * `<preset> not ready: [...]` when a phase outlasts `deadlineMs` of wall-clock time.
 */
export async function settle(
  page: Page,
  preset: Preset,
  deadlineMs = (webgpuPages.has(page) ? WEBGPU_SETTLE_DEADLINE_MS : SETTLE_DEADLINE_MS)[preset],
  overrides?: MarkerChecks,
): Promise<void> {
  const notReady = (what: unknown): Error =>
    new Error(`${preset} not ready: ${JSON.stringify(what)}`);
  const attachDeadline = Date.now() + deadlineMs;
  for (;;) {
    await step(page, 1);
    const { ready, values } = await attachments(page, preset, overrides);
    if (ready) break;
    if (Date.now() > attachDeadline) throw notReady(values);
    await page.waitForTimeout(25);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const framingDeadline = Date.now() + deadlineMs;
  let last: string | null = null;
  for (let stable = 0; stable < STABLE_FRAMES;) {
    await step(page, 1);
    const box = await framingBox(page);
    stable = box !== null && box === last ? stable + 1 : 0;
    last = box;
    if (stable < STABLE_FRAMES && Date.now() > framingDeadline)
      throw notReady(['framing unstable', box]);
  }
  await step(page, SETTLE_FRAMES);
}

/** Shifts to reverse. The sim stands still; the reversing lamps light, and the prediction aid and the follow framing move. */
export async function shiftToReverse(page: Page): Promise<void> {
  await page.keyboard.press('2');
  await step(page, 3);
  await page.locator('[data-gear="R"][aria-pressed="true"]').waitFor();
}

/** The bare canvas (HUD and controls hidden) under `shot`'s pane, as PNG; switches the view first when needed. */
export async function shoot(page: Page, shot: Shot): Promise<Buffer> {
  const key = VIEW_KEY[shot];
  if (key !== undefined) {
    await page.keyboard.press(key);
    await page.locator(`[data-view="${shot}"][aria-pressed="true"]`).waitFor();
    await step(page, SETTLE_FRAMES);
  }
  const box = await page.locator(BOX[shot]).boundingBox();
  if (box === null) throw new Error(`no box for ${shot}`);
  return bareScreenshot(page, box, () => step(page, 1));
}

/**
 * The yard view zoomed in about the pane-local point `at` by a wheel of `deltaY` (negative zooms in);
 * the view resets first, so each shot starts from the whole yard.
 */
export async function shootYardZoomed(
  page: Page,
  at: { readonly x: number; readonly y: number },
  deltaY: number,
): Promise<Buffer> {
  await page.keyboard.press('y');
  await page.locator('[data-view="yard"][aria-pressed="true"]').waitFor();
  await step(page, SETTLE_FRAMES);
  const box = await page.locator(BOX.yard).boundingBox();
  if (box === null) throw new Error('no box for yard');
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.wheel(0, deltaY);
  await step(page, SETTLE_FRAMES);
  return bareScreenshot(page, box, () => step(page, 1));
}

/** `clip` with the HUD and controls hidden, so only the canvas shows; `settle` runs once they are. */
export async function bareScreenshot(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  settle: () => Promise<void> = () => Promise.resolve(),
): Promise<Buffer> {
  await page.evaluate((id) => {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '.hud, .ctl, [class^="ctl-"] { visibility: hidden !important }';
    document.head.append(style);
  }, HIDE_ID);
  try {
    await settle();
    return await page.screenshot({ clip });
  } finally {
    await page.evaluate((id) => document.getElementById(id)?.remove(), HIDE_ID);
  }
}

/** Distinct RGB values in a PNG, so a blank or not-yet-drawn pane cannot pass as a match. */
export function distinctColours(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < px.length; i += 4) {
      seen.add(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0));
    }
    return seen.size;
  }, png.toString('base64'));
}

/** The page's scene token for `token` as 0-255 RGB (`nightBackdrop` is `--scene-night-backdrop`). */
export function sceneRgb(page: Page, token: ScenePaletteKey): Promise<[number, number, number]> {
  return page.evaluate((name) => {
    const hex = getComputedStyle(document.documentElement)
      .getPropertyValue(`--scene-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)
      .trim();
    const want = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
    if (want === undefined) throw new Error(`no scene token ${name}`);
    return [0, 2, 4].map((i) => parseInt(want.slice(i, i + 2), 16)) as [number, number, number];
  }, token);
}

/** Share of a PNG's pixels within `tolerance` per channel of `rgb` (0-255). */
export function colourShare(
  page: Page,
  png: Buffer,
  rgb: readonly [number, number, number],
  tolerance: number,
): Promise<number> {
  return page.evaluate(
    async ([data, want, tol]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      let near = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (want.every((c, k) => Math.abs((px[i + k] ?? 0) - c) <= tol)) near++;
      }
      return near / (img.width * img.height);
    },
    [png.toString('base64'), rgb, tolerance] as const,
  );
}

/**
 * The band of pixels `from` to `to` pixels (either axis) outside the `core` pixels of a PNG, and how
 * many of them are not `casing`, each colour within `tolerance` per channel: `from` clears the
 * edge blend, so a stroke drawn without its casing leaves the band bare.
 */
export function colourBorder(
  page: Page,
  png: Buffer,
  core: readonly [number, number, number],
  casing: readonly [number, number, number],
  tolerance: number,
  from: number,
  to: number,
): Promise<{ band: number; bare: number }> {
  return page.evaluate(
    async ([data, inner, outer, tol, near, far]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      const { width, height } = img;
      const is = (i: number, c: readonly number[]): boolean =>
        c.every((v, k) => Math.abs((px[i * 4 + k] ?? 0) - v) <= tol);
      const stroke = new Uint8Array(width * height);
      for (let i = 0; i < stroke.length; i++) stroke[i] = is(i, inner) ? 1 : 0;
      /** `stroke` grown by `span` along x, then along y. */
      const grow = (span: number): Uint8Array => {
        const rows = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (stroke[y * width + x] !== 1) continue;
            for (let dx = Math.max(0, x - span); dx <= Math.min(width - 1, x + span); dx++) {
              rows[y * width + dx] = 1;
            }
          }
        }
        const out = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (rows[y * width + x] !== 1) continue;
            for (let dy = Math.max(0, y - span); dy <= Math.min(height - 1, y + span); dy++) {
              out[dy * width + x] = 1;
            }
          }
        }
        return out;
      };
      const [close, wide] = [grow(near), grow(far)];
      let band = 0;
      let bare = 0;
      for (let i = 0; i < wide.length; i++) {
        if (wide[i] !== 1 || close[i] === 1) continue;
        band++;
        if (!is(i, outer)) bare++;
      }
      return { band, bare };
    },
    [png.toString('base64'), core, casing, tolerance, from, to] as const,
  );
}

/** Share of a PNG's pixels within `tolerance` per channel of the page's scene token for `token`. */
export async function tokenShare(
  page: Page,
  png: Buffer,
  token: ScenePaletteKey,
  tolerance: number,
): Promise<number> {
  return colourShare(page, png, await sceneRgb(page, token), tolerance);
}

/**
 * Bounding box (pixels, inclusive) of the solid regions of `rgb` in a PNG, within `tolerance` per
 * channel: a pixel counts when its whole 5x5 neighbourhood matches, so the one-pixel blends along the
 * edges between two other colours do not; null when no region is solid.
 */
export function colourBox(
  page: Page,
  png: Buffer,
  rgb: readonly [number, number, number],
  tolerance: number,
): Promise<{ minX: number; minY: number; maxX: number; maxY: number } | null> {
  return page.evaluate(
    async ([data, want, tol]) => {
      const reach = 2;
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      const { width, height } = img;
      const match = new Uint8Array(width * height);
      for (let i = 0; i < match.length; i++) {
        match[i] = want.every((c, k) => Math.abs((px[i * 4 + k] ?? 0) - c) <= tol) ? 1 : 0;
      }
      const solid = (x: number, y: number): boolean => {
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            if (match[(y + dy) * width + x + dx] !== 1) return false;
          }
        }
        return true;
      };
      let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
      for (let y = reach; y < height - reach; y++) {
        for (let x = reach; x < width - reach; x++) {
          if (!solid(x, y)) continue;
          box =
            box === null
              ? { minX: x, minY: y, maxX: x, maxY: y }
              : {
                  minX: Math.min(box.minX, x),
                  minY: Math.min(box.minY, y),
                  maxX: Math.max(box.maxX, x),
                  maxY: Math.max(box.maxY, y),
                };
        }
      }
      return box === null
        ? null
        : {
            minX: box.minX - reach,
            minY: box.minY - reach,
            maxX: box.maxX + reach,
            maxY: box.maxY + reach,
          };
    },
    [png.toString('base64'), rgb, tolerance] as const,
  );
}

/**
 * Channel value above which a pixel is a day sight; the night horizon and the lit ground stay well
 * below it. Mirrors show no interior, so a day dome (most of the pane) is what pushes the share up.
 */
export const DAY_BRIGHT = 110;
/** Largest share of a mirror above `DAY_BRIGHT` at night: lamp lenses and the unlit aids only. */
export const MAX_MIRROR_BRIGHT = 0.1;

/** Share of a PNG's pixels with a channel above `level` (0-255). */
export function brightShare(page: Page, png: Buffer, level: number): Promise<number> {
  return page.evaluate(
    async ([data, above]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      let bright = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (Math.max(px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0) > above) bright++;
      }
      return bright / (img.width * img.height);
    },
    [png.toString('base64'), level] as const,
  );
}

/** Share of the pixels of two same-size PNGs whose highest channel is `levels` or more (0-255) brighter in `after`. */
export function brightenedShare(
  page: Page,
  before: Buffer,
  after: Buffer,
  levels: number,
): Promise<number> {
  return page.evaluate(
    async ([a, b, step]) => {
      const read = async (data: string): Promise<ImageData> => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height);
      };
      const [x, y] = [await read(a), await read(b)];
      if (x.width !== y.width || x.height !== y.height) throw new Error('shots differ in size');
      const high = (d: Uint8ClampedArray, i: number): number =>
        Math.max(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0);
      let brighter = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        if (high(y.data, i) - high(x.data, i) >= step) brighter++;
      }
      return brighter / (x.width * x.height);
    },
    [before.toString('base64'), after.toString('base64'), levels] as const,
  );
}

export type ShotDiff = {
  readonly pixels: number;
  /** Pixels whose 3×3 neighbourhood in the before shot is one colour. */
  readonly flat: number;
  readonly flatSame: number;
  readonly flatOne: number;
  readonly flatMore: number;
  readonly maxFlat: number;
  /** Edge pixels that moved by more than one step. */
  readonly edgeMore: number;
  /** PNG: black unchanged, yellow off by one, red a flat pixel off by more, blue an edge pixel off by more. */
  readonly heatmap: Buffer;
};

/** Compares two shots of the same pane pixel by pixel, split into flat and edge pixels; null if their sizes differ. */
export async function diffShot(
  page: Page,
  before: Buffer,
  after: Buffer,
): Promise<ShotDiff | null> {
  const result = await page.evaluate(
    async ([a, b]) => {
      const decode = async (data: string): Promise<ImageData> => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height);
      };
      const [old, now] = await Promise.all([decode(a), decode(b)]);
      const { width, height } = old;
      if (now.width !== width || now.height !== height) return null;
      const p = old.data;
      const q = now.data;
      const heat = new ImageData(width, height);
      const counts = { flat: 0, flatSame: 0, flatOne: 0, flatMore: 0, maxFlat: 0, edgeMore: 0 };
      const at = (data: Uint8ClampedArray, i: number): number => data[i] ?? 0;
      const same = (i: number, j: number): boolean =>
        at(p, i) === at(p, j) && at(p, i + 1) === at(p, j + 1) && at(p, i + 2) === at(p, j + 2);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          let flat = true;
          for (let dy = -1; dy <= 1 && flat; dy++) {
            for (let dx = -1; dx <= 1 && flat; dx++) {
              const nx = Math.min(width - 1, Math.max(0, x + dx));
              const ny = Math.min(height - 1, Math.max(0, y + dy));
              flat = same(i, (ny * width + nx) * 4);
            }
          }
          const d = Math.max(
            Math.abs(at(p, i) - at(q, i)),
            Math.abs(at(p, i + 1) - at(q, i + 1)),
            Math.abs(at(p, i + 2) - at(q, i + 2)),
          );
          heat.data[i + 3] = 255;
          if (d === 1) heat.data[i] = heat.data[i + 1] = 255;
          else if (d > 1) heat.data[flat ? i : i + 2] = 255;
          if (flat) {
            counts.flat++;
            if (d === 0) counts.flatSame++;
            else if (d === 1) counts.flatOne++;
            else counts.flatMore++;
            counts.maxFlat = Math.max(counts.maxFlat, d);
          } else if (d > 1) counts.edgeMore++;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.putImageData(heat, 0, 0);
      return { ...counts, pixels: width * height, heatmap: canvas.toDataURL('image/png') };
    },
    [before.toString('base64'), after.toString('base64')] as const,
  );
  if (result === null) return null;
  return { ...result, heatmap: Buffer.from(result.heatmap.split(',')[1] ?? '', 'base64') };
}
