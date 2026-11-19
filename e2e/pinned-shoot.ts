import type { Page } from '@playwright/test';

// Imported by scripts/shoot-views.mjs through Node's type stripping: type-only imports, no enums.

export type Preset = 'low' | 'balanced' | 'high';
export type Shot = 'cockpit' | 'mirrorLeft' | 'mirrorRight' | 'follow' | 'yard' | 'chase';

const SETTINGS_KEY = 'gegenlenker.settings.v1';
const FRAME_MS = 16;
/** Frames stepped after the scene is ready, so every lazily built resource is in place. */
const SETTLE_FRAMES = 30;
const READY_STEPS = 2000;
const HIDE_ID = 'pinned-shoot-bare';

/** Each preset's asynchronous attachments, read from `<html>`; a shot before they land would differ. */
const READY: Readonly<Record<Preset, Readonly<Record<string, (value: string) => boolean>>>> = {
  low: {},
  balanced: { 'data-vehicle-shells': (v) => v.split(' ').length === 3 },
  high: {
    'data-vehicle-shells': (v) => v.split(' ').length === 3,
    'data-ground-texture': (v) => v.startsWith('ktx2:'),
    'data-vehicle-pbr': (v) => v === 'on',
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
 * so the resolution governor and the sim only move when stepped. Call on a fresh page.
 */
export async function startPinnedDrive(
  page: Page,
  preset: Preset,
  exercise: string,
): Promise<void> {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    SETTINGS_KEY,
    JSON.stringify({ version: 1, graphics: preset, topDown: 'follow' }),
  ] as const);
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto('./');
  await page.getByRole('button', { name: new RegExp(`^${exercise}`) }).click();
  await page.locator('.hud-mirror:not([hidden])').nth(1).waitFor();
  await settle(page, preset);
}

/** Steps the pinned clock until `preset`'s attachments are in place, then settles. */
export async function settle(page: Page, preset: Preset): Promise<void> {
  const want = READY[preset];
  for (let i = 0; ; i++) {
    await step(page, 1);
    const ready = await page.evaluate((names) => {
      const html = document.documentElement;
      return names.map((n) => html.getAttribute(n));
    }, Object.keys(want));
    if (Object.values(want).every((ok, j) => ok(ready[j] ?? ''))) break;
    if (i >= READY_STEPS) throw new Error(`${preset} not ready: ${JSON.stringify(ready)}`);
    await page.waitForTimeout(25);
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
  await settle();
  const png = await page.screenshot({ clip });
  await page.evaluate((id) => document.getElementById(id)?.remove(), HIDE_ID);
  return png;
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
