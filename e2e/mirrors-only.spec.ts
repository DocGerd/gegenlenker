import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import {
  chooseRunOption,
  exerciseEntry,
  openSetup,
  runOptionValue,
  startExercise,
  toTitle,
} from './menu-flow';

const SETTINGS_KEY = 'gegenlenker.settings.v1';

test('a mirror-only run has no top-down pane, keeps the brief and finish, and replays with the top view', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ version: 1, graphics: 'low' }));
    }
  }, SETTINGS_KEY);
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse', { driveView: 'mirrors' });

  const hud = page.locator('.hud');
  await expect(hud).toHaveAttribute('data-mirrors', '');
  await expect(page.locator('.hud-mirror:not([hidden])').first()).toBeVisible();
  // No top-down pane, and none of what belongs to it.
  await expect(page.locator('.hud-topdown')).toBeHidden();
  await expect(page.locator('[data-view]:visible')).toHaveCount(0);
  await expect(page.locator('[data-aid]:visible')).toHaveCount(0);
  await expect(page.locator('.hud-gauge:visible')).toHaveCount(0);
  await expect(page.locator('.hud-split-handle')).toBeHidden();
  const cockpit = await page.locator('.hud-cockpit').boundingBox();
  const viewport = page.viewportSize();
  expect(cockpit).toMatchObject({ x: 0, y: 0, width: viewport?.width, height: viewport?.height });

  // The brief, the counters and the finish button stay reachable.
  const goal = page.locator('.hud-goal');
  await expect(goal).toBeVisible();
  const brief = page.locator('.hud-goal-brief');
  await expect(brief).toHaveText(en.briefStraightReverse);
  await expect(page.locator('.hud-counters')).toBeVisible();
  const fold = page.getByRole('button', { name: en.briefToggle });
  await expect(fold).toHaveAttribute('aria-expanded', 'true');

  // The brief folds away once driving starts, and unfolds again.
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(brief).toBeHidden();
  await expect(goal).toBeVisible();
  await fold.click();
  await expect(brief).toBeVisible();

  // The view keys have no pane to switch.
  for (const key of ['y', 'o', 'f']) await page.keyboard.press(key);
  await expect(page.locator('.hud-topdown')).toBeHidden();
  const stored = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
  expect(stored).toContain('"mirrorsOnly":true');
  expect(stored).not.toContain('"topDown":"yard"');

  await page.getByRole('button', { name: en.pause }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();
  // No aid is drawn without the top view, so the run counts as unaided whatever the aid settings.
  await expect(page.getByText(en.runNoAids)).toBeVisible();

  // The replay draws the top view across the window, whatever the menu chose.
  await page.getByRole('button', { name: en.replay }).click();
  await expect(page.getByRole('slider', { name: en.timeline })).toBeVisible();
  const map = await page.locator('.replay-map').boundingBox();
  expect(map?.width).toBe(viewport?.width);
  await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(0);
});

test('the menu keeps the mirror-only choice and the replay line says so', async ({ page }) => {
  const entry = exerciseEntry('straight-reverse');
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ version: 1, graphics: 'low' }));
    }
  }, SETTINGS_KEY);
  await page.goto('./');
  await openSetup(page, en, entry);
  await expect.poll(() => runOptionValue(page, en, 'driveView')).toBe('standard');
  await chooseRunOption(page, en, 'driveView', 'mirrors');
  await page.reload();
  await openSetup(page, en, entry);
  await expect.poll(() => runOptionValue(page, en, 'driveView')).toBe('mirrors');

  await startExercise(page, en, 'straight-reverse');
  await page.getByRole('button', { name: en.pause }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await page.getByRole('button', { name: en.menu }).click();
  await toTitle(page, en);
  await expect(page.getByRole('button', { name: en.replayLastRun })).toContainText(
    en.driveViewMirrors,
  );

  await startExercise(page, en, 'straight-reverse', { driveView: 'standard' });
  await expect(page.locator('.hud-topdown')).toBeVisible();
  await expect(page.locator('.hud')).not.toHaveAttribute('data-mirrors');
});
