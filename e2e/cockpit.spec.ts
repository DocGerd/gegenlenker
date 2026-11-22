import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DRIVER_PERFORMANCE_HINT } from './three-problems';
import { en } from '../src/i18n/en';
import { COCKPIT_FOV } from '../src/render/cockpit-camera';
import { TRUCK_IDS } from '../src/contracts/vehicle';
import { cabSight } from '../src/render/cab-sight';
import { interiorLayout, pillarSpans } from '../src/render/cockpit-interior';
import { QUALITY_FLAGS } from '../src/render/quality';
import { REALISM_HUES } from '../src/render/realism-hues';
import { truckById } from '../src/vehicles/registry';
import {
  HEAVY,
  heavyAt,
  HIGH_WAIT_MS,
  PRESET_TIMEOUT_MS,
  type Preset,
  settle,
  startPinnedDrive,
} from './pinned-shoot';

/** An unlit vertex colour reaches the canvas as its hue, give or take the rounding of the sRGB frame target. */
const TOLERANCE = 1;
/** How much paler (red channel) the horizon haze is than the sky near the header. */
const HAZE_STEP = 10;
/** CSS px right of the front mirror's box that clear its frame (6 px) for a probe. */
const FRONT_FRAME_CLEAR = 10;

const rgb = (hex: number): readonly number[] => [hex >> 16, (hex >> 8) & 0xff, hex & 0xff];
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
    if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** The mirrors a drive at `preset` shows at the default viewport: class II, class IV where the preset draws it, and the front mirror. */
const mirrorsAt = (preset: Preset): number => 3 + (QUALITY_FLAGS[preset].wideMirrors ? 2 : 0);

async function drive(page: Page, preset: Preset = 'balanced'): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${en.exerciseStraightReverse}`) }).click();
  await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(mirrorsAt(preset));
  await expect(page.locator('.ctl-wheel')).toBeVisible();
}

/**
 * A drive of the exercise at `preset` with the clock pinned: the frame is drawn when stepped, so the
 * pixel probes below do not compete with a render loop for the CPU (a screenshot of a free-running
 * drive takes seconds on software GL), and the preset's attachments are in place before they read.
 */
async function pinnedDrive(page: Page, preset: Preset): Promise<void> {
  await startPinnedDrive(page, { preset, lighting: 'day' }, en.exerciseStraightReverse);
  await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(mirrorsAt(preset));
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
  return pixelsAt(page, await boxOf(page, selector), at);
}

type Box = { x: number; y: number; width: number; height: number };

/** The sRGB pixels of the bare canvas inside `pane`, at offsets from its top-left. */
async function pixelsAt(page: Page, pane: Box, at: readonly (readonly [number, number])[]) {
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
  // The default truck: the menu keeps its first entry unless a setting says otherwise.
  const sight = cabSight(truckById(TRUCK_IDS[0]));
  const { left: leftSpan, right: rightSpan } = pillarSpans(sight, aspect, COCKPIT_FOV, layout);
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

test(
  'the cockpit interior follows the graphics preset on the shared renderer',
  { tag: HEAVY },
  async ({ page }) => {
    test.setTimeout(PRESET_TIMEOUT_MS.balanced + PRESET_TIMEOUT_MS.low);
    const errors = collectErrors(page);
    await pinnedDrive(page, 'balanced');

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
      })
      .toEqual([true, true, true, true]);

    await page.getByRole('button', { name: en.finish }).click();
    await page
      .getByRole('dialog', { name: en.paused })
      .getByRole('button', { name: en.leaveUnscored })
      .click();
    await page.locator('[data-menu="graphics"]').selectOption('low');
    await drive(page, 'low');
    await settle(page, 'low');

    await expect(page.locator('.hud[data-interior]')).toHaveCount(0);
    // Sky above and ground below first: only a drawn frame can pass, so absence below means something.
    await expect
      .poll(async () => {
        const [top, bottom] = await cockpitPixels(page, [points.header, points.dash]);
        return [isSky(top), isGround(bottom)];
      })
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
  },
);

test(
  'the Balanced cockpit sky is blue near the top and fades to haze towards the horizon',
  { tag: HEAVY },
  async ({ page }) => {
    test.setTimeout(PRESET_TIMEOUT_MS.balanced);
    const errors = collectErrors(page);
    await pinnedDrive(page, 'balanced');
    const cockpit = await boxOf(page, '.hud-cockpit');
    // Above the skyline, under the header: just right of the front mirror's frame, and just above the horizon.
    const front = await boxOf(page, '[data-hud="front"]');
    const x = Math.round(front.x + front.width - cockpit.x + FRONT_FRAME_CLEAR);
    const points = [0.14, 0.31].map((f) => [x, Math.round(cockpit.height * f)] as const);
    await expect
      .poll(async () => isSky((await panePixels(page, '.hud-cockpit', points))[0]))
      .toBe(true);
    const [top = [], horizon = []] = await panePixels(page, '.hud-cockpit', points);
    expect(top[0] ?? 0, 'red channel: the haze is paler than the zenith').toBeLessThan(
      (horizon[0] ?? 0) - HAZE_STEP,
    );
    expect(errors).toEqual([]);
  },
);

/**
 * Bright and not blue: yard ground, where `isGround` alone would also take the sky. High's light
 * rig is lowered so no white clips, which leaves its lit yard darker than on the other presets.
 */
const isYard = (p: number[] | undefined): boolean =>
  p !== undefined && !isSky(p) && p.reduce((a, b) => a + b, 0) > 450;

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

/**
 * Probe points of one mirror: sky above ground at its centre column, then the edge columns. The
 * vehicle's own sun shadow can darken the whole centre column on High, so the ground check also
 * reads the outer edge.
 */
function mirrorPoints(box: Box) {
  const x = Math.round(box.width / 2);
  // several columns along the top: on High a cloud of the HDRI sky may cover one
  const top = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => [Math.round(box.width * f), 2] as const);
  return {
    centre: [...top, [x, Math.round(box.height) - 3] as const],
    left: edgePoints(box.width, box.height, 'left'),
    right: edgePoints(box.width, box.height, 'right'),
  };
}

/** The mirror pairs the probe reads: class II on every preset, class IV where the preset draws it. */
const MIRROR_PAIRS = [
  {
    name: 'each mirror',
    left: 'mirrorLeft',
    right: 'mirrorRight',
    presets: ['low', 'balanced', 'high'],
  },
  {
    name: 'each class IV mirror',
    left: 'wideLeft',
    right: 'wideRight',
    presets: ['balanced', 'high'],
  },
] as const satisfies readonly {
  name: string;
  left: string;
  right: string;
  presets: readonly Preset[];
}[];

// Balanced and High render the mirror through a multisampled target, Low through a plain one.
for (const pair of MIRROR_PAIRS) {
  for (const preset of pair.presets) {
    test(
      `${pair.name} shows the sky above, the ground below and the vehicle on its inner edge on ${preset}`,
      heavyAt(preset),
      async ({ page }) => {
        test.setTimeout(PRESET_TIMEOUT_MS[preset]);
        const wait = preset === 'high' ? { timeout: HIGH_WAIT_MS } : {};
        const errors = collectErrors(page);
        await pinnedDrive(page, preset);

        // The vehicle stands behind the cab, so it fills the edge nearest the cab: the right edge of the
        // left mirror and the left edge of the right one. Without the horizontal flip that is swapped.
        const sides = [
          { side: pair.left, inner: 'right', outer: 'left' },
          { side: pair.right, inner: 'left', outer: 'right' },
        ] as const;
        const boxes = await Promise.all(sides.map((s) => boxOf(page, `[data-hud="${s.side}"]`)));
        // One screenshot covers both mirrors: a frame is slow on software GL, so one per probe adds up.
        const left = Math.min(...boxes.map((b) => b.x));
        const top = Math.min(...boxes.map((b) => b.y));
        const area = {
          x: left,
          y: top,
          width: Math.max(...boxes.map((b) => b.x + b.width)) - left,
          height: Math.max(...boxes.map((b) => b.y + b.height)) - top,
        };
        const sample = async () => {
          const probes = boxes.map((box) => {
            const dx = Math.round(box.x - area.x);
            const dy = Math.round(box.y - area.y);
            const shift = (pts: readonly (readonly [number, number])[]) =>
              pts.map(([x, y]) => [x + dx, y + dy] as const);
            const points = mirrorPoints(box);
            return {
              centre: shift(points.centre),
              left: shift(points.left),
              right: shift(points.right),
            };
          });
          const pixels = await pixelsAt(
            page,
            area,
            probes.flatMap((p) => [...p.centre, ...p.left, ...p.right]),
          );
          let at = 0;
          const take = (n: number) => pixels.slice(at, (at += n));
          return sides.map(({ side, inner, outer }, i) => {
            const probe = probes[i];
            if (probe === undefined) throw new Error(`no probe for ${side}`);
            const centre = take(probe.centre.length);
            const bottom = centre.at(-1);
            const edges = { left: take(probe.left.length), right: take(probe.right.length) };
            const ground = [bottom, ...edges[outer]];
            return {
              side,
              // Sky above and ground below first: only a drawn frame can pass, so absence at the edge means something.
              drawn:
                centre.slice(0, -1).some(isSky) && !ground.some(isSky) && ground.some(isGround),
              outerYard: yardShare(edges[outer]),
              innerYard: yardShare(edges[inner]),
            };
          });
        };
        let seen: Awaited<ReturnType<typeof sample>> = [];
        await expect
          .poll(async () => {
            seen = await sample();
            return seen.map((s) => `${s.side}: ${String(s.drawn)}`);
          }, wait)
          .toEqual(sides.map((s) => `${s.side}: true`));
        for (const { side, outerYard, innerYard } of seen) {
          expect(outerYard, `${side} outer edge`).toBeGreaterThan(0.9);
          expect(innerYard, `${side} inner edge`).toBeLessThan(0.5);
        }
        expect(errors).toEqual([]);
      },
    );
  }
}

/** Probe points of the front mirror as fractions of its box: across the top edge, the middle and the bottom edge. */
function frontPoints(box: Box) {
  const at = (u: number, v: number) =>
    [Math.round(box.width * u), Math.round(box.height * v)] as const;
  return {
    // the cab front lies along the top edge on the driver's (left) side, past the passenger side's ground
    cab: [0.1, 0.2, 0.3].map((u) => at(u, 0.03)),
    passenger: [0.85, 0.9, 0.95].map((u) => at(u, 0.03)),
    // the far edge of the field, all ground
    far: [0.1, 0.3, 0.5, 0.7, 0.9].map((u) => at(u, 0.95)),
  };
}

for (const preset of ['low', 'balanced', 'high'] as const satisfies readonly Preset[]) {
  test(
    `the front mirror shows the cab on its top edge at the driver's side and ground beyond on ${preset}`,
    heavyAt(preset),
    async ({ page }) => {
      test.setTimeout(PRESET_TIMEOUT_MS[preset]);
      const wait = preset === 'high' ? { timeout: HIGH_WAIT_MS } : {};
      const errors = collectErrors(page);
      await pinnedDrive(page, preset);
      const box = await boxOf(page, '[data-hud="front"]');
      const points = frontPoints(box);
      const sample = async () => {
        const pixels = await pixelsAt(page, box, [
          ...points.cab,
          ...points.passenger,
          ...points.far,
        ]);
        const cab = pixels.slice(0, points.cab.length);
        const passenger = pixels.slice(cab.length, cab.length + points.passenger.length);
        const far = pixels.slice(cab.length + passenger.length);
        return {
          // ground along the far edge first: only a drawn frame can pass, so the rest means something
          drawn: far.every(isYard) && !far.some(isSky),
          cabShare: cab.filter((p) => !isYard(p) && !isSky(p)).length / cab.length,
          passengerYard: yardShare(passenger),
        };
      };
      await expect.poll(async () => (await sample()).drawn, wait).toBe(true);
      const seen = await sample();
      expect(seen.cabShare, 'cab at the top left').toBeGreaterThan(0.6);
      expect(seen.passengerYard, 'ground at the top right').toBeGreaterThan(0.6);
      expect(errors).toEqual([]);
    },
  );
}
