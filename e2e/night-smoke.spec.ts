import { createHash } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { QUALITY_FLAGS } from '../src/render/quality';
import {
  brightShare,
  DAY_BRIGHT,
  distinctColours,
  HEAVY,
  heavyAt,
  MAX_MIRROR_BRIGHT,
  MIN_DRAWN_COLOURS,
  PRESET_TIMEOUT_MS,
  type Preset,
  brightenedShare,
  type Shot,
  settle,
  shiftToReverse,
  shoot,
  startPinnedDrive,
  timeoutWithSettles,
  tokenShare,
} from './pinned-shoot';
import { collectThreeProblems, DRIVER_PERFORMANCE_HINT } from './three-problems';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const PERSPECTIVE: readonly Shot[] = ['cockpit', 'mirrorLeft', 'mirrorRight', 'chase'];
/** Most of a perspective pane the top-down clear colour may fill: a night dome that failed would show it. */
const MAX_CLEAR_COLOUR = 0.2;
/** Levels (0-255) a mirror pixel must brighten by to count as lit by the reversing lamps. */
const LAMP_STEP = 4;
/** Least share of a mirror the reversing lamps must light: a pool the driver can use, not a sliver beside the trailer. */
const MIN_REVERSING_POOL = 0.01;
/** Least share of the cockpit view the dipped beam must light on the ground ahead. */
const MIN_BEAM_POOL = 0.01;
/** Share of a shot the dark phase of the hazard lights may brighten against the lights-on look: nothing but noise. */
const MAX_DARK_PHASE_ADDED = 0.0005;

/** Channel level (0-255) above which a mirror pixel is lit ground: the ambient-lit yard stays below it, the floodlit one passes it. */
const YARD_LIT = 80;
/** Least share of a mirror the floodlit yard must light with the lamp switches off. */
const MIN_YARD_LIT = 0.25;

for (const preset of PRESETS) {
  test(
    `every perspective view draws at night without errors at ${preset}`,
    heavyAt(preset),
    async ({ page }) => {
      test.setTimeout(timeoutWithSettles(preset, 2));
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text())) errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      const three = collectThreeProblems(page);
      await startPinnedDrive(page, { preset, lighting: 'night' }, en.exerciseStraightReverse);
      const parked: Partial<Record<Shot, Buffer>> = {};
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
          parked[shot] = png;
        }
        if (shot === 'cockpit') {
          expect(
            await tokenShare(page, png, 'nightBackdrop', 0),
            `${preset} ${shot} clear colour`,
          ).toBeLessThan(MAX_CLEAR_COLOUR);
        }
      }
      if (QUALITY_FLAGS[preset].lampLight) {
        // the reversing lamps light the ground behind truck and trailer, which the mirrors show
        await shiftToReverse(page);
        for (const shot of ['mirrorLeft', 'mirrorRight'] as const) {
          const before = parked[shot];
          if (before === undefined) throw new Error(`no ${shot} shot in P`);
          const share = await brightenedShare(page, before, await shoot(page, shot), LAMP_STEP);
          expect(share, `${preset} ${shot} in R`).toBeGreaterThan(MIN_REVERSING_POOL);
        }
      }
      if (QUALITY_FLAGS[preset].yardLight) {
        // the yard's own lamps stay on with the vehicle's switched off
        await page.keyboard.press('h');
        await settle(page, preset);
        for (const shot of ['mirrorLeft', 'mirrorRight'] as const) {
          const png = await shoot(page, shot);
          expect(
            await brightShare(page, png, YARD_LIT),
            `${preset} ${shot} floodlit yard, lights off`,
          ).toBeGreaterThan(MIN_YARD_LIT);
          expect(
            await brightShare(page, png, DAY_BRIGHT),
            `${preset} ${shot} bright pixels, lights off`,
          ).toBeLessThan(MAX_MIRROR_BRIGHT);
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

type Night = {
  readonly lights: Locator;
  readonly hazard: Locator;
  readonly errors: string[];
  readonly three: string[];
};

/** A night drive of the straight reverse at `preset`, with the lamp switches and the error collectors. */
async function nightDrive(page: Page, preset: Preset): Promise<Night> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !DRIVER_PERFORMANCE_HINT.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const three = collectThreeProblems(page);
  await startPinnedDrive(page, { preset, lighting: 'night' }, en.exerciseStraightReverse);
  const lights = page.locator('[data-ctl="lights"]');
  const hazard = page.locator('[data-ctl="hazard"]');
  await expect(lights).toHaveAttribute('aria-pressed', 'true');
  await expect(hazard).toHaveAttribute('aria-pressed', 'false');
  return { lights, hazard, errors, three };
}

// Lamp lenses are what the chase view shows of the lamps; the dipped beam is what the cockpit shows.
test(
  'the lights key and button switch the lenses and the beam at night at balanced',
  { tag: HEAVY },
  async ({ page }) => {
    test.setTimeout(timeoutWithSettles('balanced', 3, 2 * PRESET_TIMEOUT_MS.balanced));
    const { lights, errors, three } = await nightDrive(page, 'balanced');
    const litCockpit = await shoot(page, 'cockpit');
    const lit = hash(await shoot(page, 'chase'));

    await page.keyboard.press('h');
    await settle(page, 'balanced');
    await expect(lights).toHaveAttribute('aria-pressed', 'false');
    const darkCockpit = await shoot(page, 'cockpit');
    expect(hash(await shoot(page, 'chase')), 'lights off').not.toBe(lit);
    // the dipped beam lights the ground ahead; with the lights off it is dark
    expect(
      await brightenedShare(page, darkCockpit, litCockpit, LAMP_STEP),
      'ground ahead with the lights on',
    ).toBeGreaterThan(MIN_BEAM_POOL);

    await lights.click();
    await settle(page, 'balanced');
    await expect(lights).toHaveAttribute('aria-pressed', 'true');
    expect(hash(await shoot(page, 'chase')), 'lights back on').toBe(lit);
    expect(errors).toEqual([]);
    expect(three).toEqual([]);
  },
);

test(
  'the hazard key and button flash the indicator lenses at night at balanced',
  { tag: HEAVY },
  async ({ page }) => {
    test.setTimeout(timeoutWithSettles('balanced', 3, 2 * PRESET_TIMEOUT_MS.balanced));
    const { hazard, errors, three } = await nightDrive(page, 'balanced');
    const litShot = await shoot(page, 'chase');
    const lit = hash(litShot);

    // the hazard lights flash with sim time: half a period apart they show both phases
    await hazard.click();
    await settle(page, 'balanced');
    await expect(hazard).toHaveAttribute('aria-pressed', 'true');
    const phases = new Map<string, Buffer>();
    for (let i = 0; i < 3; i++) {
      const png = await shoot(page, 'chase');
      phases.set(hash(png), png);
      await page.clock.runFor(HALF_FLASH_MS);
    }
    expect(phases.size, 'the hazard lights flash').toBeGreaterThan(1);
    // the dark phase adds no light to the lights-on look: the indicators are off, and the
    // side markers they flash with (and their ground glow) are dark too
    const added: number[] = [];
    for (const png of phases.values())
      added.push(await brightenedShare(page, litShot, png, LAMP_STEP));
    expect(Math.min(...added), 'dark phase adds nothing to the lights-on look').toBeLessThan(
      MAX_DARK_PHASE_ADDED,
    );

    await page.keyboard.press('x');
    await settle(page, 'balanced');
    await expect(hazard).toHaveAttribute('aria-pressed', 'false');
    expect(hash(await shoot(page, 'chase')), 'hazard lights off').toBe(lit);
    expect(errors).toEqual([]);
    expect(three).toEqual([]);
  },
);

// The switches act on press, so a second finger works while another holds the lever; Low draws fastest.
test('a second finger switches a lamp while another holds the lever', async ({ page }) => {
  test.setTimeout(timeoutWithSettles('low', 2));
  const { hazard, errors, three } = await nightDrive(page, 'low');
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
  await settle(page, 'low');
  await expect(hazard).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  expect(three).toEqual([]);
});
