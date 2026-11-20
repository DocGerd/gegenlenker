import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { exercises, layouts } from '../src/content/registry';
import { resolveLayout } from '../src/content/resolve-layout';
import { en } from '../src/i18n/en';
import {
  colourBox,
  colourShare,
  HEAVY,
  PRESET_TIMEOUT_MS,
  diffShot,
  distinctColours,
  MIN_DRAWN_COLOURS,
  sceneRgb,
  settle,
  shoot,
  shootYardZoomed,
  startPinnedDrive,
  tokenShare,
  type Preset,
  type Shot,
} from './pinned-shoot';
import { collectThreeProblems, DRIVER_PERFORMANCE_HINT } from './three-problems';
import type { LightingMode, ScenePalette, ScenePaletteKey } from '../src/contracts/render';
import { legacyIrradiance } from '../src/render/light-rig';
import { TOP_DOWN_NIGHT_LIGHT } from '../src/render/look';

const sha = (png: Buffer): string => createHash('sha256').update(png).digest('hex');
const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const SHOTS = ['follow', 'yard'] as const satisfies readonly Shot[];

/** Per channel, how far a lit flat region may sit from its dimmed night colour. */
const LIT_TOLERANCE = 2;
/** What the night top-down shots must hold: the lit grounds and body at their night colour, the clear colour exact. */
const MIN_SHARE: Readonly<
  Record<(typeof SHOTS)[number], readonly (readonly [ScenePaletteKey, number])[]>
> = {
  follow: [
    ['yard', 0.5],
    ['body', 0.005],
  ],
  yard: [
    ['nightBackdrop', 0.5],
    ['yard', 0.04],
    ['street', 0.008],
    ['verge', 0.1],
  ],
};
/** Share of night pixels allowed above their day pixel by more than one step: the night strokes and the edges the clear colour changes. */
const MAX_BRIGHTER = 0.01;

const linear = (c: number): number =>
  c <= 10.31475 ? c / 3294.6 : ((c / 255 + 0.055) / 1.055) ** 2.4;
const encode = (l: number): number =>
  Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055));

/** The sRGB code a lit upward surface of `key` stores under `share` of the day light: lin(token) times the legacy irradiance over pi times `share`. */
async function nightCode(
  page: Page,
  key: ScenePaletteKey,
  share: number,
): Promise<[number, number, number]> {
  const [sr, sg, sb] = await sceneRgb(page, 'sky');
  const dim =
    (legacyIrradiance({ sky: (sr << 16) | (sg << 8) | sb } as ScenePalette) / Math.PI) * share;
  const [r, g, b] = await sceneRgb(page, key);
  return [encode(linear(r) * dim), encode(linear(g) * dim), encode(linear(b) * dim)];
}

type Brighter = { readonly pixels: number; readonly brighter: number };

/** Counts the pixels of `night` with a channel more than one step above the same pixel of `day`. */
function brighterThanDay(page: Page, day: Buffer, night: Buffer): Promise<Brighter> {
  return page.evaluate(
    async ([dayData, nightData]) => {
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
      const a = await read(dayData);
      const b = await read(nightData);
      if (a.width !== b.width || a.height !== b.height) throw new Error('shots differ in size');
      let brighter = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        if ([0, 1, 2].some((k) => (b.data[i + k] ?? 0) > (a.data[i + k] ?? 0) + 1)) brighter++;
      }
      return { pixels: a.width * a.height, brighter };
    },
    [day.toString('base64'), night.toString('base64')] as const,
  );
}

/** Wheel delta of the zoomed shots: past the limit, so the zoom is the yard view's maximum. */
const ZOOM_WHEEL = -1500;
/** Per channel, how far a pixel may sit from an accent or casing token to count as that stroke. */
const ACCENT_TOLERANCE = 2;
/**
 * How far the night accent count may sit from the day accent count of the same shot. The night
 * strokes have the day strokes' geometry, so the cores match pixel for pixel; only the blends at
 * their edges differ, over another ground.
 */
const ACCENT_MATCH = 0.05;
/** Pixels slack on that match, for the shots where the strokes are a pixel or two. */
const ACCENT_SLACK_PX = 2;
/** Accent pixels a zoom on a stroke must hold (the zoomed outline and gate hold several thousand), so a miss of the stroke fails. */
const MIN_ZOOM_ACCENT_PX = 2000;
/**
 * Pixels of the wheel colour the night zoom must hold over the day zoom: the night casings of the
 * outline and the gate ring, about 2700 px at the yard view's maximum zoom, of which at least a
 * quarter are the pure colour. The lit wheels of a vehicle in frame drop out at night, so a zoom
 * without a casing falls short.
 */
const MIN_CASING_PX = 800;
/** The two yards' exercises: slalom's depot has a gate, the bay's logistics yard has none. */
const EXERCISES = [
  { id: 'slalom', name: en.exerciseSlalom, zooms: ['target', 'gate'] },
  { id: 'reverse-bay', name: en.exerciseReverseBay, zooms: ['target'] },
] as const;
type Zoom = (typeof EXERCISES)[number]['zooms'][number];

/** The pane-local pixel of each world point, from the box the yard's own colour fills in the yard shot. */
async function paneMapper(
  page: Page,
  yardPng: Buffer,
  yardCode: readonly [number, number, number],
  yard: { minX: number; minY: number; maxX: number; maxY: number },
): Promise<(world: { x: number; y: number }) => { x: number; y: number }> {
  const box = await colourBox(page, yardPng, yardCode, LIT_TOLERANCE);
  if (box === null) throw new Error('no yard colour in the yard shot');
  const sx = (box.maxX - box.minX + 1) / (yard.maxX - yard.minX);
  const sy = (box.maxY - box.minY + 1) / (yard.maxY - yard.minY);
  // the yard fills its box on both axes: a mismatch means the box is not the yard
  expect(Math.abs(sx / sy - 1), 'the yard colour fills the yard').toBeLessThan(0.1);
  return (w) => ({
    x: box.minX + (w.x - yard.minX) * sx,
    y: box.maxY + 1 - (w.y - yard.minY) * sy,
  });
}

// DPR 1 only: the preset's pixel-ratio cap changes resolution, a performance knob, not what is drawn.
// One exercise per yard, so each yard's restyled props are covered, and the slalom's gate renders.
for (const { id, name: exercise, zooms } of EXERCISES) {
  test(
    `the top-down view at night is the same at every graphics preset and never brighter than by day: ${exercise}`,
    { tag: HEAVY },
    async ({ context }, testInfo) => {
      const found = exercises.find((e) => e.id === id);
      if (found === undefined) throw new Error(`no exercise ${id}`);
      const layout = resolveLayout(layouts[found.layout], found);
      const world: Record<Zoom, { x: number; y: number } | null> = {
        target: layout.target?.pose ?? null,
        gate: layout.waypoint,
      };
      const names: readonly string[] = [...SHOTS, ...zooms];
      // the three night presets and the day shot of the cheapest one
      test.setTimeout(
        PRESETS.reduce((sum, preset) => sum + PRESET_TIMEOUT_MS[preset], PRESET_TIMEOUT_MS.low),
      );
      const errors: string[] = [];
      const threeProblems: string[] = [];
      const shots = {
        night: new Map<string, Map<Preset, Buffer>>(names.map((n) => [n, new Map()])),
        day: new Map<string, Map<Preset, Buffer>>(names.map((n) => [n, new Map()])),
      };
      const tokens = {} as Record<'accent' | 'nightAccent' | 'wheel', [number, number, number]>;
      const drive = async (preset: Preset, lighting: LightingMode): Promise<void> => {
        const page = await context.newPage();
        page.on('console', (m) => {
          if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text()))
            errors.push(m.text());
        });
        page.on('pageerror', (e) => errors.push(e.message));
        const three = collectThreeProblems(page);
        await startPinnedDrive(page, { preset, lighting }, exercise);
        for (const key of ['accent', 'nightAccent', 'wheel'] as const) {
          tokens[key] = await sceneRgb(page, key);
        }
        const share = lighting === 'night' ? TOP_DOWN_NIGHT_LIGHT : 1;
        const taken = async (shot: string, png: Buffer, drawn: boolean): Promise<string> => {
          const label = `${exercise} ${preset} ${lighting} ${shot}`;
          await testInfo.attach(`${label}.png`, { body: png, contentType: 'image/png' });
          if (drawn) {
            expect(await distinctColours(page, png), label).toBeGreaterThan(MIN_DRAWN_COLOURS);
          }
          shots[lighting].get(shot)?.set(preset, png);
          return label;
        };
        let yardPng: Buffer | null = null;
        const hashes = new Map<string, string>();
        for (const shot of SHOTS) {
          const png = await shoot(page, shot);
          hashes.set(shot, sha(png));
          const label = await taken(shot, png, true);
          if (shot === 'yard') yardPng = png;
          if (lighting !== 'night') continue;
          for (const [token, min] of MIN_SHARE[shot]) {
            const found =
              token === 'nightBackdrop'
                ? await tokenShare(page, png, token, 0)
                : await colourShare(page, png, await nightCode(page, token, share), LIT_TOLERANCE);
            expect(found, `${label}: ${token}`).toBeGreaterThan(min);
          }
          // the strokes are unlit: the night accent draws, the day accent does not
          expect(await tokenShare(page, png, 'accent', 2), `${label}: day accent`).toBe(0);
        }
        if (yardPng === null) throw new Error('no yard shot');
        if (lighting === 'night') {
          // the lamps are perspective-only: switching the lights off and the hazard lights on changes no top-down pixel
          await page.keyboard.press('h');
          await page.keyboard.press('x');
          await settle(page, preset);
          await expect(page.locator('[data-ctl="lights"]')).toHaveAttribute(
            'aria-pressed',
            'false',
          );
          await expect(page.locator('[data-ctl="hazard"]')).toHaveAttribute('aria-pressed', 'true');
          for (const shot of SHOTS) {
            const again = sha(await shoot(page, shot));
            expect(again, `${exercise} ${preset} ${shot} with the lamp keys pressed`).toBe(
              hashes.get(shot),
            );
          }
        }
        const paneAt = await paneMapper(
          page,
          yardPng,
          await nightCode(page, 'yard', share),
          layout.yard,
        );
        for (const zoom of zooms) {
          const at = world[zoom];
          if (at === null) throw new Error(`${exercise} has no ${zoom}`);
          // a zoom on a stroke is mostly flat ground: the accent count below says it drew
          await taken(zoom, await shootYardZoomed(page, paneAt(at), ZOOM_WHEEL), false);
        }
        threeProblems.push(...three);
        await page.close();
      };
      await drive('low', 'day');
      for (const preset of PRESETS) await drive(preset, 'night');

      const scratch = await context.newPage();
      const mismatches: string[] = [];
      for (const shot of names) {
        const base = shots.night.get(shot)?.get('low');
        const day = shots.day.get(shot)?.get('low');
        if (base === undefined || day === undefined) throw new Error(`no ${shot} shot`);
        for (const preset of PRESETS.slice(1)) {
          const png = shots.night.get(shot)?.get(preset);
          if (png === undefined) throw new Error(`no ${shot} shot at ${preset}`);
          if (sha(png) === sha(base)) continue;
          const pair = `${exercise} ${shot} at night: low vs ${preset}`;
          const diff = await diffShot(scratch, base, png);
          if (diff === null) {
            mismatches.push(`${pair} differ in size`);
            continue;
          }
          const { heatmap, ...counts } = diff;
          await testInfo.attach(`${pair} diff.png`, { body: heatmap, contentType: 'image/png' });
          mismatches.push(`${pair} ${JSON.stringify(counts)}`);
        }
        const { pixels, brighter } = await brighterThanDay(scratch, day, base);
        const count = async (
          png: Buffer,
          rgb: readonly [number, number, number],
        ): Promise<number> =>
          Math.round((await colourShare(scratch, png, rgb, ACCENT_TOLERANCE)) * pixels);
        const [dayAccent, nightAccent] = [
          await count(day, tokens.accent),
          await count(base, tokens.nightAccent),
        ];
        const label = `${exercise} ${shot}`;
        if (
          Math.abs(nightAccent - dayAccent) > Math.max(ACCENT_SLACK_PX, ACCENT_MATCH * dayAccent)
        ) {
          mismatches.push(
            `${label}: ${nightAccent} night accent pixels against ${dayAccent} by day`,
          );
        }
        if ((SHOTS as readonly string[]).includes(shot)) {
          if (brighter > pixels * MAX_BRIGHTER) {
            mismatches.push(`${label}: ${brighter} of ${pixels} pixels brighter than by day`);
          }
          continue;
        }
        if (nightAccent < MIN_ZOOM_ACCENT_PX) {
          mismatches.push(
            `${label}: only ${nightAccent} night accent pixels, the stroke is not in frame`,
          );
        }
        const casing = (await count(base, tokens.wheel)) - (await count(day, tokens.wheel));
        if (casing < MIN_CASING_PX) {
          mismatches.push(
            `${label}: ${casing} more casing pixels than by day, under ${MIN_CASING_PX}`,
          );
        }
      }
      await scratch.close();
      expect(mismatches, 'top-down shots at night').toEqual([]);
      expect(errors).toEqual([]);
      expect(threeProblems).toEqual([]);
    },
  );
}
