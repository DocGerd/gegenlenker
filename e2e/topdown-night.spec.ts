import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import {
  colourShare,
  HEAVY,
  PRESET_TIMEOUT_MS,
  diffShot,
  distinctColours,
  MIN_DRAWN_COLOURS,
  sceneRgb,
  shoot,
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

/** The sRGB code a lit upward surface of `key` stores at night: lin(token) times the legacy irradiance over pi times the night share. */
async function nightCode(page: Page, key: ScenePaletteKey): Promise<[number, number, number]> {
  const [sr, sg, sb] = await sceneRgb(page, 'sky');
  const dim =
    (legacyIrradiance({ sky: (sr << 16) | (sg << 8) | sb } as ScenePalette) / Math.PI) *
    TOP_DOWN_NIGHT_LIGHT;
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

// DPR 1 only: the preset's pixel-ratio cap changes resolution, a performance knob, not what is drawn.
// One exercise per yard, so each yard's restyled props are covered.
for (const exercise of [en.exerciseStraightReverse, en.exerciseReverseBay]) {
  test(
    `the top-down view at night is the same at every graphics preset and never brighter than by day: ${exercise}`,
    { tag: HEAVY },
    async ({ context }, testInfo) => {
      // the three night presets and the day shot of the cheapest one
      test.setTimeout(
        PRESETS.reduce((sum, preset) => sum + PRESET_TIMEOUT_MS[preset], PRESET_TIMEOUT_MS.low),
      );
      const errors: string[] = [];
      const threeProblems: string[] = [];
      const shots = {
        night: { follow: new Map<Preset, Buffer>(), yard: new Map<Preset, Buffer>() },
        day: { follow: new Map<Preset, Buffer>(), yard: new Map<Preset, Buffer>() },
      };
      const drive = async (preset: Preset, lighting: LightingMode): Promise<void> => {
        const page = await context.newPage();
        page.on('console', (m) => {
          if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text()))
            errors.push(m.text());
        });
        page.on('pageerror', (e) => errors.push(e.message));
        const three = collectThreeProblems(page);
        await startPinnedDrive(page, { preset, lighting }, exercise);
        for (const shot of SHOTS) {
          const png = await shoot(page, shot);
          const name = `${exercise} ${preset} ${lighting} ${shot}`;
          await testInfo.attach(`${name}.png`, { body: png, contentType: 'image/png' });
          expect(await distinctColours(page, png), name).toBeGreaterThan(MIN_DRAWN_COLOURS);
          if (lighting === 'night') {
            for (const [token, min] of MIN_SHARE[shot]) {
              const share =
                token === 'nightBackdrop'
                  ? await tokenShare(page, png, token, 0)
                  : await colourShare(page, png, await nightCode(page, token), LIT_TOLERANCE);
              expect(share, `${name}: ${token}`).toBeGreaterThan(min);
            }
            // the strokes are unlit: the night accent draws, the day accent does not
            expect(await tokenShare(page, png, 'accent', 2), `${name}: day accent`).toBe(0);
            if (shot === 'yard') {
              expect(
                await tokenShare(page, png, 'nightAccent', 2),
                `${name}: night accent`,
              ).toBeGreaterThan(0);
            }
          }
          shots[lighting][shot].set(preset, png);
        }
        threeProblems.push(...three);
        await page.close();
      };
      await drive('low', 'day');
      for (const preset of PRESETS) await drive(preset, 'night');

      const scratch = await context.newPage();
      const mismatches: string[] = [];
      for (const shot of SHOTS) {
        const base = shots.night[shot].get('low');
        const day = shots.day[shot].get('low');
        if (base === undefined || day === undefined) throw new Error(`no ${shot} shot`);
        for (const preset of PRESETS.slice(1)) {
          const png = shots.night[shot].get(preset);
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
        if (brighter > pixels * MAX_BRIGHTER) {
          mismatches.push(
            `${exercise} ${shot}: ${brighter} of ${pixels} pixels brighter than by day`,
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
