import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';
import { COCKPIT_FOV } from '../src/render/cockpit-camera';
import { interiorLayout, pillarSpan } from '../src/render/cockpit-interior';
import { REALISM_HUES } from '../src/render/realism-hues';
import { SCREENSHOT_POLL, throughIntermediate } from './pinned-shoot';

const SETTINGS_KEY = 'gegenlenker.settings.v1';
/** What is left of an unlit vertex colour's distance from the hue once the 8-bit intermediate's rounding is applied to the hue. */
const TOLERANCE = 3;
/** How much paler (red channel) the horizon haze is than the sky near the header. */
const HAZE_STEP = 10;

const rgb = (hex: number): readonly number[] =>
  throughIntermediate([hex >> 16, (hex >> 8) & 0xff, hex & 0xff]);
const HEADLINER = rgb(REALISM_HUES.headliner);
const DASH = rgb(REALISM_HUES.chevronBlack);
const PILLAR = rgb(REALISM_HUES.anthracite);

const near = (pixel: number[] | undefined, want: readonly number[]): boolean =>
  pixel !== undefined && want.every((c, i) => Math.abs((pixel[i] ?? 0) - c) <= TOLERANCE);
/** The sky gradient at the top of the Low view is blue-dominant; the yard ground is light grey. */
const isSky = (p: number[] | undefined): boolean =>
  p !== undefined && (p[2] ?? 0) - (p[0] ?? 0) > 40;
const isGround = (p: number[] | undefined): boolean =>
  p !== undefined && p.reduce((a, b) => a + b, 0) > 400;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function drive(page: Page): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${en.exerciseStraightReverse}`) }).click();
  await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(2);
  await expect(page.locator('.ctl-wheel')).toBeVisible();
}

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`no ${selector}`);
  return box;
}

/** The sRGB pixels of the bare cockpit canvas (HUD and controls hidden) at the given offsets from the cockpit's top-left. */
function cockpitPixels(page: Page, at: readonly (readonly [number, number])[]) {
  return panePixels(page, '.hud-cockpit', at);
}

/** The sRGB pixels of the bare canvas under `selector`'s box, at offsets from its top-left. */
async function panePixels(
  page: Page,
  selector: string,
  at: readonly (readonly [number, number])[],
) {
  const pane = await boxOf(page, selector);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'bare-canvas';
    style.textContent = '.hud, .ctl, [class^="ctl-"] { visibility: hidden !important }';
    document.head.append(style);
  });
  const shot = (await page.screenshot({ clip: pane })).toString('base64');
  await page.evaluate(() => {
    document.getElementById('bare-canvas')?.remove();
  });
  return page.evaluate(
    async ([data, points]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)));
    },
    [shot, at] as const,
  );
}

/** Probe points: roof header, dashboard edge, and the centre of each pillar where the layout draws one. */
async function probePoints(page: Page) {
  const cockpit = await boxOf(page, '.hud-cockpit');
  const left = await boxOf(page, '[data-hud="mirrorLeft"]');
  const right = await boxOf(page, '[data-hud="mirrorRight"]');
  const layout = interiorLayout(cockpit, left, right);
  const aspect = cockpit.width / cockpit.height;
  const leftSpan = pillarSpan(aspect, COCKPIT_FOV, layout.left);
  const rightSpan = pillarSpan(aspect, COCKPIT_FOV, layout.right);
  if (leftSpan === null || rightSpan === null) throw new Error('no pillar at this viewport');
  const x = Math.round(cockpit.width * 0.55);
  const mid = Math.round(cockpit.height / 2);
  const ndc = (v: number) => Math.round(((1 + v) / 2) * cockpit.width);
  return {
    header: [x, 3],
    dash: [x, Math.round(cockpit.height) - 4],
    pillarLeft: [ndc(-leftSpan.centre), mid],
    pillarRight: [ndc(rightSpan.centre), mid],
  } as const;
}

test('the cockpit interior follows the graphics preset on the shared renderer', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.addInitScript(
    ([key, value]) => {
      // Only the first load seeds the setting; the menu owns it afterwards.
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [SETTINGS_KEY, JSON.stringify({ version: 1, graphics: 'balanced' })] as const,
  );
  await page.goto('./');
  await drive(page);

  await expect(page.locator('.hud[data-interior]')).toHaveCount(1);
  const points = await probePoints(page);
  await expect
    .poll(async () => {
      const [header, dash, pillarLeft, pillarRight] = await cockpitPixels(page, [
        points.header,
        points.dash,
        points.pillarLeft,
        points.pillarRight,
      ]);
      return [
        near(header, HEADLINER),
        near(dash, DASH),
        near(pillarLeft, PILLAR),
        near(pillarRight, PILLAR),
      ];
    }, SCREENSHOT_POLL)
    .toEqual([true, true, true, true]);

  await page.getByRole('button', { name: en.finish }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.leaveUnscored })
    .click();
  await page.locator('[data-menu="graphics"]').selectOption('low');
  await drive(page);

  await expect(page.locator('.hud[data-interior]')).toHaveCount(0);
  // Sky above and ground below first: only a drawn frame can pass, so absence below means something.
  await expect
    .poll(async () => {
      const [top, bottom] = await cockpitPixels(page, [points.header, points.dash]);
      return [isSky(top), isGround(bottom)];
    }, SCREENSHOT_POLL)
    .toEqual([true, true]);
  const [header, dash, pillarLeft, pillarRight] = await cockpitPixels(page, [
    points.header,
    points.dash,
    points.pillarLeft,
    points.pillarRight,
  ]);
  expect(near(header, HEADLINER)).toBe(false);
  expect(near(dash, DASH)).toBe(false);
  expect(near(pillarLeft, PILLAR)).toBe(false);
  expect(near(pillarRight, PILLAR)).toBe(false);
  expect(errors).toEqual([]);
});

test('the Balanced cockpit sky is blue near the top and fades to haze towards the horizon', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    SETTINGS_KEY,
    JSON.stringify({ version: 1, graphics: 'balanced' }),
  ] as const);
  await page.goto('./');
  await drive(page);
  const cockpit = await boxOf(page, '.hud-cockpit');
  // Between the pillars, above the skyline: just under the header, and just above the horizon.
  const x = Math.round(cockpit.width * 0.58);
  const points = [0.14, 0.31].map((f) => [x, Math.round(cockpit.height * f)] as const);
  await expect
    .poll(async () => isSky((await panePixels(page, '.hud-cockpit', points))[0]), SCREENSHOT_POLL)
    .toBe(true);
  const [top = [], horizon = []] = await panePixels(page, '.hud-cockpit', points);
  expect(top[0] ?? 0, 'red channel: the haze is paler than the zenith').toBeLessThan(
    (horizon[0] ?? 0) - HAZE_STEP,
  );
  expect(errors).toEqual([]);
});

/** Bright and not blue: yard ground, where `isGround` alone would also take the sky. */
const isYard = (p: number[] | undefined): boolean =>
  p !== undefined && !isSky(p) && p.reduce((a, b) => a + b, 0) > 500;

/** Probe points in the lower half of a mirror, on three columns hugging its left or right edge. */
function edgePoints(width: number, height: number, side: 'left' | 'right') {
  const columns = [0.03, 0.08, 0.13].map((f) => Math.round(width * (side === 'left' ? f : 1 - f)));
  const rows = [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((f) =>
    Math.round(height * f),
  );
  return rows.flatMap((y) => columns.map((x) => [x, y] as const));
}

const yardShare = (pixels: (number[] | undefined)[]): number =>
  pixels.filter(isYard).length / pixels.length;

// Balanced and High render the mirror through a multisampled target, Low through a plain one.
for (const preset of ['low', 'balanced', 'high']) {
  test(`each mirror shows the sky above, the ground below and the vehicle on its inner edge on ${preset}`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      SETTINGS_KEY,
      JSON.stringify({ version: 1, graphics: preset }),
    ] as const);
    await page.goto('./');
    await drive(page);
    // The vehicle stands behind the cab, so it fills the edge nearest the cab: the right edge of the
    // left mirror and the left edge of the right one. Without the horizontal flip that is swapped.
    for (const [side, inner] of [
      ['mirrorLeft', 'right'],
      ['mirrorRight', 'left'],
    ] as const) {
      const selector = `[data-hud="${side}"]`;
      const box = await boxOf(page, selector);
      const x = Math.round(box.width / 2);
      const outer = inner === 'right' ? 'left' : 'right';
      await expect
        .poll(
          async () => {
            const [top, bottom] = await panePixels(page, selector, [
              [x, 2],
              [x, Math.round(box.height) - 3],
            ]);
            return [isSky(top) && !isSky(bottom), isGround(bottom)];
          },
          { message: side, ...SCREENSHOT_POLL },
        )
        .toEqual([true, true]);
      const outerYard = yardShare(
        await panePixels(page, selector, edgePoints(box.width, box.height, outer)),
      );
      const innerYard = yardShare(
        await panePixels(page, selector, edgePoints(box.width, box.height, inner)),
      );
      expect(outerYard, `${side} outer edge`).toBeGreaterThan(0.9);
      expect(innerYard, `${side} inner edge`).toBeLessThan(0.5);
    }
    expect(errors).toEqual([]);
  });
}
