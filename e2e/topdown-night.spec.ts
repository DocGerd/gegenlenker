import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import {
  HEAVY,
  PRESET_TIMEOUT_MS,
  diffShot,
  distinctColours,
  MIN_DRAWN_COLOURS,
  shoot,
  startPinnedDrive,
  tokenShare,
  type Preset,
  type Shot,
} from './pinned-shoot';
import { collectThreeProblems, DRIVER_PERFORMANCE_HINT } from './three-problems';
import type { LightingMode, ScenePaletteKey } from '../src/contracts/render';

const sha = (png: Buffer): string => createHash('sha256').update(png).digest('hex');
const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const SHOTS = ['follow', 'yard'] as const satisfies readonly Shot[];

/** Per channel, how far a flat region may sit from its token; the clear colour is unlit and exact. */
const TOKEN_TOLERANCE: Readonly<Partial<Record<ScenePaletteKey, number>>> = {
  nightBackdrop: 0,
  yard: 8,
  street: 5,
  verge: 6,
  body: 7,
};
/** What the night top-down shots must hold: the day shares, with the night clear colour for the day one. */
const MIN_TOKEN_SHARE: Readonly<
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

type Drawn = { readonly pixels: number; readonly changed: number; readonly strays: number };

/**
 * Compares a night shot with the day shot of the same view. A pixel may differ only where the day
 * shot showed the clear colour, or beside it: the multisample resolve blends a ground edge with
 * whichever clear colour is behind it, so those edge pixels change with it.
 */
function changedOffBackdrop(
  page: Page,
  day: Buffer,
  night: Buffer,
  backdrop: string,
): Promise<Drawn> {
  return page.evaluate(
    async ([dayData, nightData, hex]) => {
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
      const want = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
      if (want === undefined) throw new Error('no backdrop colour');
      const rgb = [0, 2, 4].map((i) => parseInt(want.slice(i, i + 2), 16));
      const a = await read(dayData);
      const b = await read(nightData);
      if (a.width !== b.width || a.height !== b.height) throw new Error('shots differ in size');
      const { width, height } = a;
      const isBackdrop = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const i = (y * width + x) * 4;
        return rgb.every((c, k) => a.data[i + k] === c);
      };
      let changed = 0;
      let strays = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if ([0, 1, 2].every((k) => a.data[i + k] === b.data[i + k])) continue;
          changed++;
          let near = false;
          for (let dy = -1; dy <= 1 && !near; dy++) {
            for (let dx = -1; dx <= 1 && !near; dx++) near = isBackdrop(x + dx, y + dy);
          }
          if (!near) strays++;
        }
      }
      return { pixels: width * height, changed, strays };
    },
    [day.toString('base64'), night.toString('base64'), backdrop] as const,
  );
}

// DPR 1 only: the preset's pixel-ratio cap changes resolution, a performance knob, not what is drawn.
// One exercise per yard, so each yard's restyled props are covered.
for (const exercise of [en.exerciseStraightReverse, en.exerciseReverseBay]) {
  test(
    `the top-down view at night is the same at every graphics preset and changes only the clear colour: ${exercise}`,
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
      let dayBackdrop = '';
      const drive = async (preset: Preset, lighting: LightingMode): Promise<void> => {
        const page = await context.newPage();
        page.on('console', (m) => {
          if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text()))
            errors.push(m.text());
        });
        page.on('pageerror', (e) => errors.push(e.message));
        const three = collectThreeProblems(page);
        await startPinnedDrive(page, { preset, lighting }, exercise);
        if (lighting === 'day') {
          dayBackdrop = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--scene-backdrop').trim(),
          );
        }
        for (const shot of SHOTS) {
          const png = await shoot(page, shot);
          const name = `${exercise} ${preset} ${lighting} ${shot}`;
          await testInfo.attach(`${name}.png`, { body: png, contentType: 'image/png' });
          expect(await distinctColours(page, png), name).toBeGreaterThan(MIN_DRAWN_COLOURS);
          if (lighting === 'night') {
            for (const [token, min] of MIN_TOKEN_SHARE[shot]) {
              const share = await tokenShare(page, png, token, TOKEN_TOLERANCE[token] ?? 0);
              expect(share, `${name}: ${token}`).toBeGreaterThan(min);
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
        const drawn = await changedOffBackdrop(scratch, day, base, dayBackdrop);
        if (drawn.strays > 0) {
          mismatches.push(`${exercise} ${shot}: ${drawn.strays} pixels changed off the backdrop`);
        }
        if (shot === 'yard') {
          expect(drawn.changed, `${exercise} yard: the clear colour changed`).toBeGreaterThan(
            drawn.pixels / 4,
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
