import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import {
  exerciseEntry,
  openSetup,
  startControl,
  startExercise,
  startYard,
  toTitle,
} from './menu-flow';
import { seedStorage } from './menu-seed';
import { heavyAt } from './pinned-shoot';

const speed = (page: Page) => page.locator('[data-hud="speed"]');
const clock = (page: Page) => page.locator('[data-hud="time"]');
const sheet = (page: Page) => page.getByRole('dialog', { name: en.paused });
const menuHeading = (page: Page) => page.getByRole('heading', { name: en.appName });
// The menu sits on the base entry; a stale drive or result entry would show up in its state.
const historyState = (page: Page) => page.evaluate(() => history.state as unknown);

async function finishRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: en.pause }).click();
  await sheet(page).getByRole('button', { name: en.finish }).click();
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();
}

async function startAndRoll(page: Page): Promise<void> {
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  await expect(speed(page)).toHaveText('0.0 km/h');
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(speed(page)).not.toHaveText('0.0 km/h');
}

test('back pauses the drive and back again continues', async ({ page }) => {
  await startAndRoll(page);
  await page.goBack();
  await expect(sheet(page)).toBeVisible();

  const paused = await speed(page).textContent();
  const pausedAt = await clock(page).textContent();
  await page.waitForTimeout(1200);
  await expect(speed(page)).toHaveText(paused ?? '');
  await expect(clock(page)).toHaveText(pausedAt ?? '');

  await page.goBack();
  await expect(sheet(page)).toBeHidden();
  // Speed may already sit at its plateau, so the run clock proves the sim resumed.
  await expect(clock(page)).not.toHaveText(pausedAt ?? '');
});

test('Escape pauses the drive and Escape again continues', async ({ page }) => {
  await startAndRoll(page);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByText(en.restartHint)).toBeVisible();
  const pausedAt = await clock(page).textContent();
  await page.waitForTimeout(600);
  await expect(clock(page)).toHaveText(pausedAt ?? '');

  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect(clock(page)).not.toHaveText(pausedAt ?? '');
});

test('the sheet takes the keyboard: Space continues instead of braking', async ({ page }) => {
  await startAndRoll(page);
  await page.goBack();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(sheet(page)).toBeHidden();
  await expect(speed(page)).not.toHaveText('0.0 km/h');
});

test('restart leaves no result and no replay', async ({ page }) => {
  await startAndRoll(page);
  await page.goBack();
  await sheet(page).getByRole('button', { name: en.restart }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(speed(page)).toHaveText('0.0 km/h');

  // A reload returns to the menu, where an unscored restart must have stored nothing.
  await page.reload();
  await toTitle(page, en);
  await expect(page.getByRole('button', { name: en.replayLastRun })).toHaveCount(0);
});

test('finish scores, back leaves the result, and the replay names the exercise', async ({
  page,
}) => {
  await startAndRoll(page);
  await page.getByRole('button', { name: en.pause }).click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: en.finish }).click();
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();

  await page.goBack();
  await toTitle(page, en);
  const replay = page.getByRole('button', { name: en.replayLastRun });
  await expect(replay).toContainText(en.exerciseStraightReverse);
});

test('the result prints angles as <n>° without a space', async ({ page }) => {
  await startAndRoll(page);
  await page.getByRole('button', { name: en.pause }).click();
  await sheet(page).getByRole('button', { name: en.finish }).click();
  const values = page.locator('.result-values');
  await expect(values).toContainText(/\d°/);
  await expect(values).not.toContainText(/\d\s°/);
});

test('the sheet covers the messages', async ({ page }) => {
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  const toast = page.locator('[data-hud="toast"]');
  await expect(toast).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeVisible();
  // The wrap takes no pointer events, so let it, or `elementFromPoint` skips the toast.
  const covered = await toast.evaluate((el) => {
    const wrap = el.parentElement;
    if (wrap === null) throw new Error('no toast wrap');
    wrap.style.pointerEvents = 'auto';
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    wrap.style.pointerEvents = '';
    return top !== null && top.closest('.pause') !== null;
  });
  expect(covered, 'a message paints over the pause sheet').toBe(true);
});

test('the sheet keeps focus: a backdrop click does not hand Space to the run', async ({ page }) => {
  await startAndRoll(page);
  await page.goBack();
  await expect(sheet(page)).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(sheet(page).getByRole('button', { name: en.continue })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(sheet(page)).toBeHidden();
  await expect(speed(page)).not.toHaveText('0.0 km/h');
});

test('a restarted drive still pauses on back', async ({ page }) => {
  await startAndRoll(page);
  await page.goBack();
  await sheet(page).getByRole('button', { name: en.restart }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(speed(page)).toHaveText('0.0 km/h');

  await page.goBack();
  await expect(sheet(page)).toBeVisible();
  await page.goBack();
  await expect(sheet(page)).toBeHidden();
});

test('the free yard sheet leaves through Menu without a stale entry', async ({ page }) => {
  await page.goto('./');
  await startYard(page, en, 'depot');
  await page.locator('[data-hud="action"]').click();
  await sheet(page).getByRole('button', { name: en.menu }).click();
  await expect(menuHeading(page)).toBeVisible();
  expect(await historyState(page)).toBeNull();
});

test('the result menu button leaves without a stale entry', async ({ page }) => {
  await startAndRoll(page);
  await finishRun(page);
  await page.getByRole('button', { name: en.menu }).click();
  await expect(menuHeading(page)).toBeVisible();
  expect(await historyState(page)).toBeNull();
});

test('back from a replay returns to the result, and back again to the menu', async ({ page }) => {
  await startAndRoll(page);
  await finishRun(page);
  await page.getByRole('button', { name: en.replay }).click();
  await expect(page.getByRole('button', { name: en.back })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();
  await page.goBack();
  await expect(menuHeading(page)).toBeVisible();
  expect(await historyState(page)).toBeNull();
});

test('the result focuses its primary action: Enter retries', async ({ page }) => {
  await startAndRoll(page);
  await finishRun(page);
  await expect(page.getByRole('button', { name: en.retry })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(speed(page)).toHaveText('0.0 km/h');
  await expect(sheet(page)).toBeHidden();
});

test('the result dialog is named by its outcome, so focus entering it announces it', async ({
  page,
}) => {
  await startAndRoll(page);
  await finishRun(page);
  const dialog = page.getByRole('dialog', { name: en.targetMissed });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: en.retry })).toBeFocused();
});

test('Escape leaves the result for the menu, and a miss is no best', async ({ page }) => {
  await startAndRoll(page);
  await finishRun(page);
  await page.keyboard.press('Escape');
  await toTitle(page, en);
  await expect(page.getByText(en.targetMissed)).toHaveCount(0);
  await expect(page.getByRole('button', { name: en.replayLastRun })).toBeVisible();
});

test('Escape leaves a replay for the result, and again for the menu', async ({ page }) => {
  await startAndRoll(page);
  await finishRun(page);
  await page.getByRole('button', { name: en.replay }).click();
  await expect(page.getByRole('button', { name: en.back })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menuHeading(page)).toBeVisible();
  expect(await historyState(page)).toBeNull();
});

test('a Space held through the finish does not activate the focused result button', async ({
  page,
}) => {
  await startAndRoll(page);
  await page.keyboard.down('Space');
  await finishRun(page);
  await expect(page.getByRole('button', { name: en.retry })).toBeFocused();
  await page.keyboard.down('Space'); // auto-repeat
  await page.keyboard.up('Space');
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();

  // Once released, a fresh press works again.
  await page.keyboard.press('Space');
  await expect(speed(page)).toHaveText('0.0 km/h');
});

test('an Enter held through the finish does not activate the focused result button', async ({
  page,
}) => {
  await startAndRoll(page);
  await page.keyboard.down('Enter');
  await finishRun(page);
  await expect(page.getByRole('button', { name: en.retry })).toBeFocused();
  await page.keyboard.down('Enter'); // auto-repeat
  await page.keyboard.up('Enter');
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();

  // Once released, a fresh press works again.
  await page.keyboard.press('Enter');
  await expect(speed(page)).toHaveText('0.0 km/h');
});

const gear = (page: Page) => page.locator('[data-hud="gear"]');
const toast = (page: Page) => page.locator('[data-hud="toast"]');

test('driving keys reach the run after Escape closes the sheet', async ({ page }) => {
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  await expect(speed(page)).toHaveText('0.0 km/h');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await page.keyboard.press('2');
  await expect(gear(page)).toHaveText('R');
});

test('driving keys reach the run after Restart', async ({ page }) => {
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  await expect(speed(page)).toHaveText('0.0 km/h');
  await page.keyboard.press('Escape');
  await sheet(page).getByRole('button', { name: en.restart }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(gear(page)).toHaveText('P'); // the restarted drive has mounted
  await page.keyboard.press('2');
  await expect(gear(page)).toHaveText('R');
});

test('the start hints to select R or D until a gear is chosen', async ({ page }) => {
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  await expect(speed(page)).toHaveText('0.0 km/h');
  await expect(toast(page)).toHaveText(en.selectGear);
  await expect(page.locator('[data-hud="toastWrap"]')).toHaveAttribute('role', 'status');
  await expect(page.locator('[data-hud="toastWrap"]')).toHaveAttribute('aria-atomic', 'false');
  await page.keyboard.press('2');
  await expect(toast(page)).toBeHidden();
  await page.keyboard.press('1');
  await page.keyboard.press('w');
  await expect(toast(page)).toHaveText(en.selectGear);
});

test('the free yard pause sheet has no restart hint', async ({ page }) => {
  await page.goto('./');
  await startYard(page, en, 'depot');
  await page.getByRole('button', { name: en.pause }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByText(en.restartHint)).toHaveCount(0);
});

async function pauseWith(page: Page, settings: object): Promise<void> {
  await seedStorage(page, { settings });
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  await expect(speed(page)).toHaveText('0.0 km/h');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeVisible();
}

const openSettings = async (page: Page): Promise<void> => {
  await sheet(page).getByRole('button', { name: en.settings }).click();
  await expect(sheet(page).getByRole('heading', { name: en.settings })).toBeVisible();
};

const choice = (page: Page, row: string, value: string) =>
  sheet(page).getByRole('radiogroup', { name: row }).getByRole('radio', { name: value });

test(
  'Settings opens inside the pause dialog; Esc and back each return to the actions, and the next Esc resumes',
  heavyAt('low'),
  async ({ page }) => {
    await pauseWith(page, { graphics: 'low' });
    const settings = sheet(page).getByRole('button', { name: en.settings });

    await openSettings(page);
    await expect(choice(page, en.theme, en.themeSystem)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(settings).toBeFocused();
    await expect(sheet(page).getByRole('button', { name: en.continue })).toBeVisible();

    await openSettings(page);
    await page.goBack();
    await expect(settings).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
  },
);

test(
  'Tab stays inside the pause dialog on its Settings level',
  heavyAt('low'),
  async ({ page }) => {
    await pauseWith(page, { graphics: 'low' });
    await openSettings(page);
    const back = sheet(page).getByRole('button', { name: en.back });
    const lastRow = choice(page, en.graphics, en.graphicsLow);
    await page.keyboard.press('Shift+Tab');
    await expect(back).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(lastRow).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(back).toBeFocused();

    const inside = () =>
      page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(key);
        expect(await inside(), `${key} ${String(i + 1)} left the dialog`).toBe(true);
      }
    }
    await page.keyboard.press('w');
    await page.keyboard.press('2');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    // A few frames of the resumed sim would apply any key that reached the run.
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r));
    });
    await expect(gear(page)).toHaveText('P');
    await expect(speed(page)).toHaveText('0.0 km/h');
  },
);

test('an Enter held on Back does not reopen Settings', heavyAt('low'), async ({ page }) => {
  await pauseWith(page, { graphics: 'low' });
  await openSettings(page);
  await page.keyboard.press('Shift+Tab');
  const back = sheet(page).getByRole('button', { name: en.back });
  await expect(back).toBeFocused();
  await page.keyboard.down('Enter');
  const settings = sheet(page).getByRole('button', { name: en.settings });
  await expect(settings).toBeFocused();
  // The repeat lands on the Settings button of the actions.
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(settings).toBeFocused();
  await expect(sheet(page).getByRole('heading', { name: en.settings })).toHaveCount(0);
});

test('the theme changes at once from the pause sheet', heavyAt('low'), async ({ page }) => {
  await pauseWith(page, { graphics: 'low', theme: 'light' });
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await openSettings(page);
  // Pointer users hit the label, not the small radio.
  await sheet(page).getByText(en.themeDark, { exact: true }).click();
  await expect(choice(page, en.theme, en.themeDark)).toBeChecked();
  await expect(page.locator('html[data-theme="dark"]')).toHaveCount(1);
});

test(
  'graphics quality from the pause sheet applies from the next start',
  heavyAt('balanced'),
  async ({ page }) => {
    await pauseWith(page, { graphics: 'balanced' });
    const chase = page.locator('[data-view="chase"]');
    await expect(chase).toHaveCount(1);
    await openSettings(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(choice(page, en.graphics, en.graphicsBalanced)).toBeFocused();
    await expect(sheet(page).getByText(en.appliesNextStart)).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(choice(page, en.graphics, en.graphicsLow)).toBeChecked();
    await expect(chase).toHaveCount(1);

    await page.keyboard.press('Escape');
    await sheet(page).getByRole('button', { name: en.restart }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(speed(page)).toHaveText('0.0 km/h');
    await expect(chase).toHaveCount(0);
  },
);

test('leaving without scoring stores no result and no replay', async ({ page }) => {
  await startAndRoll(page);
  await page.keyboard.press('Escape');
  await sheet(page).getByRole('button', { name: en.leaveUnscored }).click();
  await toTitle(page, en);
  await expect(page.getByText(en.targetMissed)).toHaveCount(0);
  await expect(page.getByRole('button', { name: en.replayLastRun })).toHaveCount(0);

  await page.reload();
  await toTitle(page, en);
  await expect(page.getByRole('button', { name: en.replayLastRun })).toHaveCount(0);
});

test(
  'a double click on Start leaves no text selected and starts one drive',
  heavyAt('low'),
  async ({ page }) => {
    await seedStorage(page, { settings: { graphics: 'low' } });
    const entry = exerciseEntry('straight-reverse');
    await page.goto('./');
    await openSetup(page, en, entry);
    await startControl(page, en, entry).dblclick();
    await expect(speed(page)).toHaveText('0.0 km/h');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    await expect(page.locator('.drive')).toHaveCount(1);
  },
);
