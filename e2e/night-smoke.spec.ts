import { createHash } from 'node:crypto';
import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { QUALITY_FLAGS } from '../src/render/quality';
import {
  brightShare,
  DAY_BRIGHT,
  distinctColours,
  HEAVY,
  MAX_MIRROR_BRIGHT,
  MIN_DRAWN_COLOURS,
  PRESET_TIMEOUT_MS,
  type Preset,
  type Shot,
  settle,
  shoot,
  startPinnedDrive,
  tokenShare,
} from './pinned-shoot';
import { collectThreeProblems, DRIVER_PERFORMANCE_HINT } from './three-problems';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const PERSPECTIVE: readonly Shot[] = ['cockpit', 'mirrorLeft', 'mirrorRight', 'chase'];
/** Most of a perspective pane the top-down clear colour may fill: a night dome that failed would show it. */
const MAX_CLEAR_COLOUR = 0.2;

for (const preset of PRESETS) {
  test(
    `every perspective view draws at night without errors at ${preset}`,
    { tag: HEAVY },
    async ({ page }) => {
      test.setTimeout(PRESET_TIMEOUT_MS[preset]);
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text())) errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      const three = collectThreeProblems(page);
      await startPinnedDrive(page, { preset, lighting: 'night' }, en.exerciseStraightReverse);
      for (const shot of PERSPECTIVE) {
        if (shot === 'chase' && !QUALITY_FLAGS[preset].chaseView) continue;
        const png = await shoot(page, shot);
        expect(await distinctColours(page, png), `${preset} ${shot}`).toBeGreaterThan(
          MIN_DRAWN_COLOURS,
        );
        if (shot === 'mirrorLeft' || shot === 'mirrorRight') {
          expect(
            await brightShare(page, png, DAY_BRIGHT),
            `${preset} ${shot} bright pixels`,
          ).toBeLessThan(MAX_MIRROR_BRIGHT);
        }
        if (shot === 'cockpit') {
          expect(
            await tokenShare(page, png, 'nightBackdrop', 0),
            `${preset} ${shot} clear colour`,
          ).toBeLessThan(MAX_CLEAR_COLOUR);
        }
      }
      expect(errors).toEqual([]);
      expect(three).toEqual([]);
    },
  );
}

/** Half the hazard flash period (`FLASH_PERIOD` in src/render/lamp-state.ts), in ms. */
const HALF_FLASH_MS = 1000 / 3;
const hash = (png: Buffer): string => createHash('sha256').update(png).digest('hex');

// Lamp lenses are what the chase view shows of the lamps; the light they cast is not asserted here.
test(
  'the lamp keys and buttons switch the lenses at night at balanced',
  { tag: HEAVY },
  async ({ page }) => {
    test.setTimeout(PRESET_TIMEOUT_MS.balanced);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text())) errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const three = collectThreeProblems(page);
    await startPinnedDrive(
      page,
      { preset: 'balanced', lighting: 'night' },
      en.exerciseStraightReverse,
    );
    const lights = page.locator('[data-ctl="lights"]');
    const hazard = page.locator('[data-ctl="hazard"]');
    await expect(lights).toHaveAttribute('aria-pressed', 'true');
    await expect(hazard).toHaveAttribute('aria-pressed', 'false');
    const lit = hash(await shoot(page, 'chase'));

    await page.keyboard.press('h');
    await settle(page, 'balanced');
    await expect(lights).toHaveAttribute('aria-pressed', 'false');
    const dark = hash(await shoot(page, 'chase'));
    expect(dark, 'lights off').not.toBe(lit);

    await lights.click();
    await settle(page, 'balanced');
    await expect(lights).toHaveAttribute('aria-pressed', 'true');
    expect(hash(await shoot(page, 'chase')), 'lights back on').toBe(lit);

    // the hazard lights flash with sim time: half a period apart they show both phases
    await hazard.click();
    await settle(page, 'balanced');
    await expect(hazard).toHaveAttribute('aria-pressed', 'true');
    const phases = new Set<string>();
    for (let i = 0; i < 3; i++) {
      phases.add(hash(await shoot(page, 'chase')));
      await page.clock.runFor(HALF_FLASH_MS);
    }
    expect(phases.size, 'the hazard lights flash').toBeGreaterThan(1);
    expect(phases, 'dark phase is the lights-on look').toContain(lit);

    await page.keyboard.press('x');
    await settle(page, 'balanced');
    await expect(hazard).toHaveAttribute('aria-pressed', 'false');
    expect(hash(await shoot(page, 'chase')), 'hazard lights off').toBe(lit);

    // a finger held on the lever must not stop a second finger's tap from switching a lamp
    const cdp = await page.context().newCDPSession(page);
    const centre = async (loc: Locator): Promise<{ x: number; y: number }> => {
      const box = await loc.boundingBox();
      if (box === null) throw new Error('no box');
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const held = await centre(page.locator('[data-ctl="lever"]'));
    const tap = await centre(hazard);
    const touch = (
      type: 'touchStart' | 'touchEnd',
      ...touchPoints: { x: number; y: number; id: number }[]
    ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    await touch('touchStart', { ...held, id: 1 });
    await touch('touchStart', { ...held, id: 1 }, { ...tap, id: 2 });
    await touch('touchEnd', { ...held, id: 1 });
    await touch('touchEnd');
    await settle(page, 'balanced');
    await expect(hazard).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
    expect(three).toEqual([]);
  },
);
