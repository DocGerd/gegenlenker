import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { resolveRun } from '../src/content/run';
import { exerciseById } from '../src/content/registry';
import { TRAILER_IDS, TRUCK_IDS } from '../src/contracts/vehicle';
import { bestKey, serializeBestResults } from '../src/scoring/best';
import type { RunResult } from '../src/contracts/exercise';
import {
  brightShare,
  DAY_BRIGHT,
  heavyAt,
  MAX_MIRROR_BRIGHT,
  timeoutWithSettles,
  type Preset,
  settle,
  shoot,
  startPinnedDrive,
} from './pinned-shoot';
import { yardEntry } from './menu-flow';

const SETTINGS_KEY = 'gegenlenker.settings.v1';
const BEST_KEY = 'gegenlenker.best.v2';
/** A day mirror pane is mostly dome: far above the night share, which stays under `MAX_MIRROR_BRIGHT`. */
const MIN_DAY_MIRROR_BRIGHT = 0.3;

const lightingSelect = (page: Page) => page.getByRole('combobox', { name: en.lighting });

/** Seeds Low graphics on the first load only, so a saved menu choice survives later loads. */
async function seedLow(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ version: 1, graphics: 'low' }));
    }
  }, SETTINGS_KEY);
}

async function backToMenu(page: Page): Promise<void> {
  await page.locator('[data-hud="action"]').click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.menu })
    .click();
}

/** Drives the exercise on the mode chosen in the menu, settled on the pinned clock; reads a mirror pane. */
async function driveFromMenu(page: Page, preset: Preset, mode: 'day' | 'night'): Promise<number> {
  await lightingSelect(page).selectOption(mode);
  await page.getByRole('button', { name: new RegExp(`^${en.layoutDepot}`) }).click();
  await expect(page.locator('html')).toHaveAttribute('data-render-lighting', mode);
  await settle(page, preset);
  return brightShare(page, await shoot(page, 'mirrorLeft'), DAY_BRIGHT);
}

for (const preset of ['low', 'high'] as const) {
  test(
    `the menu Day/Night choice changes the drawn look, day to night to day, at ${preset}`,
    heavyAt(preset),
    async ({ page }) => {
      test.setTimeout(timeoutWithSettles(preset, 3));
      await startPinnedDrive(page, { preset, lighting: 'day' }, yardEntry('depot'));
      expect(
        await brightShare(page, await shoot(page, 'mirrorLeft'), DAY_BRIGHT),
        'start',
      ).toBeGreaterThan(MIN_DAY_MIRROR_BRIGHT);

      await backToMenu(page);
      expect(await driveFromMenu(page, preset, 'night'), 'night').toBeLessThan(MAX_MIRROR_BRIGHT);

      await backToMenu(page);
      expect(await driveFromMenu(page, preset, 'day'), 'day again').toBeGreaterThan(
        MIN_DAY_MIRROR_BRIGHT,
      );
    },
  );
}

test('the menu shows the bests of the chosen time of day, and the choice is saved', async ({
  page,
}) => {
  const exercise = exerciseById('straight-reverse');
  const [truckId] = TRUCK_IDS;
  const [trailerId] = TRAILER_IDS;
  const night: RunResult = {
    exerciseId: exercise.id,
    truckId,
    trailerId,
    reached: true,
    assisted: false,
    lighting: 'night',
    mirrorsOnly: false,
    waypointMissed: false,
    positionError: 0.1,
    angleError: 0.01,
    contacts: 0,
    jackknifes: 0,
    directionChanges: 1,
    time: 42.5,
  };
  const stored = serializeBestResults(
    { [bestKey(exercise.id, truckId, trailerId, false, 'night', false)]: night },
    (ids) => resolveRun({ ...ids, layoutId: exerciseById(ids.exerciseId).layout }).fingerprint,
  );
  await page.addInitScript(
    ([settingsKey, bestKeyName, best]) => {
      if (localStorage.getItem(settingsKey) === null) {
        localStorage.setItem(settingsKey, JSON.stringify({ version: 1, graphics: 'low' }));
        localStorage.setItem(bestKeyName, best);
      }
    },
    [SETTINGS_KEY, BEST_KEY, stored] as const,
  );
  const exerciseButton = page.getByRole('button', { name: en.exerciseStraightReverse });

  await page.goto('./');
  await expect(lightingSelect(page)).toHaveValue('day');
  await expect(exerciseButton).toContainText(en.noResult);
  await lightingSelect(page).selectOption('night');
  await expect(exerciseButton).toContainText(`${en.best} · ${en.noAids}: ${en.targetReached}`);
  await expect(exerciseButton).not.toContainText(en.noResult);
  await lightingSelect(page).selectOption('day');
  await expect(exerciseButton).toContainText(en.noResult);

  await lightingSelect(page).selectOption('night');
  await page.reload();
  await expect(lightingSelect(page)).toHaveValue('night');
  await expect(exerciseButton).toContainText(en.targetReached);
});

test('a night run keeps its Night label and replays at night while the menu shows day', async ({
  page,
}) => {
  await seedLow(page);
  const html = page.locator('html');
  await page.goto('./');
  await lightingSelect(page).selectOption('night');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(html).toHaveAttribute('data-render-lighting', 'night');
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: en.pause }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await page.getByRole('button', { name: en.menu }).click();

  const replay = page.getByRole('button', { name: en.replayLastRun });
  await expect(replay).toContainText(en.lightingNight);
  await lightingSelect(page).selectOption('day');
  await expect(replay).toContainText(en.lightingNight);
  await replay.click();
  await expect(page.getByRole('slider', { name: en.timeline })).toBeVisible();
  await expect(html).toHaveAttribute('data-render-lighting', 'night');
});
