import type { Page } from '@playwright/test';
import type { ScenePaletteKey } from '../src/contracts/render';

// Imported by scripts/shoot-views.mjs through Node's type stripping: type-only imports, no enums.

export type Preset = 'low' | 'balanced' | 'high';
export type Shot = 'cockpit' | 'mirrorLeft' | 'mirrorRight' | 'follow' | 'yard' | 'chase';

const SETTINGS_KEY = 'gegenlenker.settings.v1';
const FRAME_MS = 16;
/** Frames stepped after the scene is ready, so every lazily built resource is in place. */
const SETTLE_FRAMES = 30;
/** Wall-clock bound on one `settle`, below every spec's test timeout, so a preset that never readies fails by name. */
const SETTLE_DEADLINE_MS = 60_000;
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
/** For a poll that screenshots the canvas: software GL (CI) takes a few seconds to draw the first frame. */
export const SCREENSHOT_POLL = { timeout: 10_000 } as const;
/**
 * For a poll that screenshots a High pane: one screenshot waits for a frame or two of the
 * multisampled PBR scene, each of which takes seconds on software GL, so a single iteration can
 * outlast `SCREENSHOT_POLL`.
 */
export const HIGH_SCREENSHOT_POLL = { timeout: 30_000 } as const;
/** For a ground texture load on a fresh renderer: fetch, transcode and shader build, slow on software GL (CI). */
export const GROUND_LOAD = { timeout: 20_000 } as const;

/** Set once the renderer is ready and removed on a loss, so a settle after a loss waits for the new one. */
const BACKEND_READY = (v: string): boolean => v !== '';

/** Each preset's asynchronous attachments, read from `<html>`; a shot before they land would differ. */
const READY: Readonly<Record<Preset, Readonly<Record<string, (value: string) => boolean>>>> = {
  low: { 'data-render-backend': BACKEND_READY },
  balanced: {
    'data-render-backend': BACKEND_READY,
    'data-vehicle-shells': (v) => v.split(' ').length === 3,
  },
  high: {
    'data-render-backend': BACKEND_READY,
    'data-vehicle-shells': (v) => v.split(' ').length === 3,
    'data-ground-texture': (v) => v.startsWith('ktx2:'),
    'data-vehicle-pbr': (v) => v === 'on',
    'data-sky-hdri': (v) => v === 'on',
    'data-perspective-grade': (v) => v === 'on',
  },
};

const BOX: Readonly<Record<Shot, string>> = {
  cockpit: '[data-hud="cockpit"]',
  mirrorLeft: '[data-hud="mirrorLeft"]',
  mirrorRight: '[data-hud="mirrorRight"]',
  follow: '[data-hud="topDown"]',
  yard: '[data-hud="topDown"]',
  chase: '[data-hud="topDown"]',
};
const VIEW_KEY: Partial<Record<Shot, string>> = { follow: 'f', yard: 'y', chase: 'o' };

async function step(page: Page, frames: number): Promise<void> {
  await page.clock.runFor(frames * FRAME_MS);
}

/**
 * Opens a standstill drive of `exercise` on `preset` with `performance.now`, timers and rAF frozen,
 * so the resolution governor and the sim only move when stepped. Call on a fresh page; `search` is
 * the app URL's query (`?backend=webgpu`).
 */
export async function startPinnedDrive(
  page: Page,
  preset: Preset,
  exercise: string,
  search = '',
): Promise<void> {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    SETTINGS_KEY,
    JSON.stringify({ version: 1, graphics: preset, topDown: 'follow' }),
  ] as const);
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto(`./${withFramingFlag(search)}`);
  await page.getByRole('button', { name: new RegExp(`^${exercise}`) }).click();
  await page.locator('.hud-mirror:not([hidden])').nth(1).waitFor();
  await settle(page, preset);
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
): Promise<{ ready: boolean; values: (string | null)[] }> {
  const want = READY[preset];
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
    return Math.round((canvas.width / canvas.clientWidth) * 1000) / 1000;
  });
}

/** The vehicle's screen box without the sim step, and the render scale, so it reads the same while the sim stands still; null until drawn. */
async function framingBox(page: Page): Promise<string | null> {
  const raw = await page.locator('.drive').getAttribute('data-vehicle-box');
  if (raw === null) return null;
  const { left, top, right, bottom } = JSON.parse(raw) as Record<string, number>;
  return JSON.stringify([left, top, right, bottom, await renderScale(page)]);
}

/**
 * Steps the pinned clock until `preset`'s attachments are in place, fonts are loaded and the follow
 * framing (derived from the measured HUD chrome) has held for several frames, then settles. Throws
 * `<preset> not ready: [...]` after `deadlineMs` of wall-clock time.
 */
export async function settle(
  page: Page,
  preset: Preset,
  deadlineMs = SETTLE_DEADLINE_MS,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  const notReady = (values: unknown[]): Error =>
    new Error(`${preset} not ready: ${JSON.stringify(values)}`);
  for (;;) {
    await step(page, 1);
    const { ready, values } = await attachments(page, preset);
    if (ready) break;
    if (Date.now() > deadline) throw notReady(values);
    await page.waitForTimeout(25);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  let last: string | null = null;
  for (let stable = 0; stable < STABLE_FRAMES;) {
    await step(page, 1);
    const box = await framingBox(page);
    stable = box !== null && box === last ? stable + 1 : 0;
    last = box;
    if (stable < STABLE_FRAMES && Date.now() > deadline) throw notReady([box]);
  }
  await step(page, SETTLE_FRAMES);
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

/**
 * An sRGB colour as the 8-bit linear intermediate returns it: each channel decoded to linear, rounded
 * to a byte, and encoded again. Dark channels move the most.
 */
export function throughIntermediate(rgb: readonly number[]): number[] {
  return rgb.map((c) => {
    const v = c / 255;
    const linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    const q = Math.round(linear * 255) / 255;
    const encoded = q <= 0.0031308 ? q * 12.92 : 1.055 * q ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
}

/** Share of a PNG's pixels within `tolerance` per channel of the page's `--scene-<token>` colour. */
export function tokenShare(
  page: Page,
  png: Buffer,
  token: ScenePaletteKey,
  tolerance: number,
): Promise<number> {
  return page.evaluate(
    async ([data, name, tol]) => {
      const hex = getComputedStyle(document.documentElement)
        .getPropertyValue(`--scene-${name}`)
        .trim();
      const want = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
      if (want === undefined) throw new Error(`no scene token ${name}`);
      const rgb = [0, 2, 4].map((i) => parseInt(want.slice(i, i + 2), 16));
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
        if (rgb.every((c, k) => Math.abs((px[i + k] ?? 0) - c) <= tol)) near++;
      }
      return near / (img.width * img.height);
    },
    [png.toString('base64'), token, tolerance] as const,
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
