import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import {
  exerciseEntry,
  openSetup,
  startControl,
  startExercise,
  startYard,
  toTitle,
} from './menu-flow';
import { reachedResult, seedStorage } from './menu-seed';
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

const SETTINGS_KEY = 'gegenlenker.settings.v1';
const storedLastEntry = (page: Page): Promise<unknown> =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as { lastEntry?: unknown }).lastEntry;
  }, SETTINGS_KEY);
const reverseCorner = { role: 'driver', kind: 'exercise', id: 'reverse-corner' };
const continueButton = (page: Page) => page.getByRole('button', { name: en.continue });

test('a held Space from a run does not start Continue', heavyAt('low'), async ({ page }) => {
  await seedStorage(page, { settings: { graphics: 'low' } });
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  await expect(speed(page)).toHaveText('0.0 km/h');
  await page.keyboard.down('Space');
  await page.getByRole('button', { name: en.pause }).click();
  await sheet(page).getByRole('button', { name: en.leaveUnscored }).click();
  await toTitle(page, en);
  await expect(continueButton(page)).toBeFocused();
  await expect(continueButton(page)).toBeEnabled();
  await expect(continueButton(page)).not.toHaveAttribute('aria-busy', 'true');
  await page.keyboard.down('Space'); // auto-repeat
  await page.keyboard.up('Space');
  await expect(page.locator('.drive')).toHaveCount(0);
  await expect(continueButton(page)).toBeFocused();
});

test('Continue starts the entry it offers and stores it', heavyAt('low'), async ({ page }) => {
  // The last entry is done, so Continue offers the next one, not the stored one.
  await seedStorage(page, {
    settings: {
      graphics: 'low',
      lastEntry: { role: 'driver', kind: 'exercise', id: 'straight-reverse' },
    },
    best: [reachedResult('straight-reverse')],
  });
  await page.goto('./');
  await continueButton(page).click();
  await expect(page.locator('[data-hud="goalTitle"]')).toHaveText(en.exerciseReverseBay);
  await expect
    .poll(() => storedLastEntry(page))
    .toEqual({ role: 'driver', kind: 'exercise', id: 'reverse-bay' });
});

test('a double click on Continue starts one drive', heavyAt('low'), async ({ page }) => {
  await seedStorage(page, { settings: { graphics: 'low', lastEntry: reverseCorner } });
  await page.goto('./');
  await continueButton(page).dblclick();
  await expect(speed(page)).toHaveText('0.0 km/h');
  await expect(page.locator('.drive')).toHaveCount(1);
});

test(
  'Start and Retry store the last entry once the drive has mounted',
  heavyAt('low'),
  async ({ page }) => {
    await seedStorage(page, { settings: { graphics: 'low' } });
    await page.goto('./');
    await startExercise(page, en, 'reverse-bay');
    await expect(speed(page)).toHaveText('0.0 km/h');
    const reverseBay = { role: 'driver', kind: 'exercise', id: 'reverse-bay' };
    await expect.poll(() => storedLastEntry(page)).toEqual(reverseBay);

    await finishRun(page);
    await page.evaluate((key) => {
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as object;
      localStorage.setItem(key, JSON.stringify({ ...stored, lastEntry: null }));
    }, SETTINGS_KEY);
    await page.getByRole('button', { name: en.retry }).click();
    await expect(speed(page)).toHaveText('0.0 km/h');
    await expect.poll(() => storedLastEntry(page)).toEqual(reverseBay);
  },
);

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
  await expect(sheet(page).locator('.pause-hint')).toHaveCount(0);
});

for (const { locale, messages } of [
  { locale: 'en-US', messages: en },
  { locale: 'de-DE', messages: de },
]) {
  for (const size of [
    { width: 800, height: 585 },
    { width: 820, height: 1180 },
  ]) {
    test(`the sheet explains Finish and Leave and fits ${size.width}x${size.height} in ${locale}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ locale, viewport: size });
      const page = await context.newPage();
      await page.goto('./');
      await startExercise(page, messages, 'straight-reverse');
      await expect(speed(page)).toHaveText(/^0[.,]0 km\/h$/);
      await page.keyboard.press('Escape');
      const dialog = page.getByRole('dialog', { name: messages.paused });
      await expect(dialog).toBeVisible();

      const pairs = [
        [messages.restart, messages.restartHint],
        [messages.finish, messages.finishHint],
        [messages.leaveUnscored, messages.leaveHint],
      ] as const;
      for (const [label, hint] of pairs) {
        const button = dialog.getByRole('button', { name: label, exact: true });
        const text = dialog.getByText(hint, { exact: true });
        await expect(text).toBeVisible();
        await expect(button).toHaveAccessibleDescription(hint);
        // The hint sits right under its own button, not under a neighbour's.
        const b = await button.boundingBox();
        const h = await text.boundingBox();
        if (b === null || h === null) throw new Error('no box');
        expect(h.y, `${label} hint below its button`).toBeGreaterThanOrEqual(b.y + b.height);
        expect(h.y - (b.y + b.height), `${label} hint hugs its button`).toBeLessThan(12);
      }

      // Nothing scrolls or clips: the content fits the sheet, and the sheet the viewport.
      const fit = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          overflow: el.scrollHeight - el.clientHeight,
          top: r.top,
          bottom: window.innerHeight - r.bottom,
        };
      });
      expect(fit.overflow, 'the sheet scrolls').toBeLessThanOrEqual(0);
      expect(fit.top, 'the sheet starts inside the viewport').toBeGreaterThanOrEqual(0);
      expect(fit.bottom, 'the sheet ends inside the viewport').toBeGreaterThanOrEqual(0);
      await context.close();
    });
  }
}

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
  'graphics quality from the pause sheet applies at once and the run carries on',
  heavyAt('balanced'),
  async ({ page }) => {
    await seedStorage(page, { settings: { graphics: 'low' } });
    await page.goto('./?framing=1');
    await startExercise(page, en, 'straight-reverse');
    await expect(speed(page)).toHaveText('0.0 km/h');
    await page.keyboard.press('4');
    for (let i = 0; i < 5; i++) await page.keyboard.press('w');
    await expect(speed(page)).not.toHaveText('0.0 km/h');
    const html = page.locator('html');
    const chase = page.locator('[data-view="chase"]');
    const interior = page.locator('[data-hud="root"][data-interior]');
    const step = async (): Promise<number> => {
      const box = await page.locator('.drive').getAttribute('data-vehicle-box');
      return (JSON.parse(box ?? '{}') as { step: number }).step;
    };
    await expect(chase).toHaveCount(0);
    await expect(interior).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeVisible();
    const pausedAt = await clock(page).textContent();
    const pausedStep = await step();
    // The frames drawn when the last shell attached, which the paused view must still draw.
    await page.evaluate(() => {
      const html = document.documentElement;
      const observer = new MutationObserver(() => {
        if ((html.getAttribute('data-vehicle-shells') ?? '').split(' ').length !== 3) return;
        html.dataset['drawnAtAttach'] =
          document.querySelector<HTMLElement>('.drive')?.dataset['drawn'];
        observer.disconnect();
      });
      observer.observe(html, { attributeFilter: ['data-vehicle-shells'] });
    });
    await openSettings(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(choice(page, en.graphics, en.graphicsLow)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(choice(page, en.graphics, en.graphicsBalanced)).toBeChecked();
    await expect(chase).toHaveCount(1);
    await expect(interior).toHaveCount(1);
    await expect(html).toHaveAttribute('data-drawn-at-attach', /^\d+$/);
    const drawnAtAttach = Number(await html.getAttribute('data-drawn-at-attach'));
    await expect
      .poll(async () => Number(await page.locator('.drive').getAttribute('data-drawn')))
      .toBeGreaterThan(drawnAtAttach);
    await expect(clock(page)).toHaveText(pausedAt ?? '');
    expect(await step()).toBe(pausedStep);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await expect(clock(page)).not.toHaveText(pausedAt ?? '');
    await expect.poll(step).toBeGreaterThan(pausedStep);
    await expect(speed(page)).not.toHaveText('0.0 km/h');
  },
);

test(
  'a preset without the outside view or looking around falls back from them',
  heavyAt('high'),
  async ({ page }) => {
    await seedStorage(page, { settings: { graphics: 'high', topDown: 'yard' } });
    await page.goto('./?framing=1');
    await startExercise(page, en, 'straight-reverse');
    await expect(speed(page)).toHaveText('0.0 km/h');
    const yard = page.locator('[data-view="yard"]');
    const chase = page.locator('[data-view="chase"]');
    const free = page.locator('[data-hud="freeCamera"]');
    const yaw = async (): Promise<number> => {
      const head = await page.locator('.drive').getAttribute('data-head');
      return (JSON.parse(head ?? '{"yaw":0}') as { yaw: number }).yaw;
    };
    await expect(yard).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.down('KeyQ');
    await expect.poll(yaw).not.toBe(0);
    await chase.click();
    await page.keyboard.press('k');
    await expect(free).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await openSettings(page);
    await sheet(page).getByText(en.graphicsLow, { exact: true }).click();
    await expect(choice(page, en.graphics, en.graphicsLow)).toBeChecked();
    await expect(chase).toHaveCount(0);
    await expect(free).toHaveCount(0);
    await expect(page.locator('[data-hud="root"][data-interior]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-vehicle-shells');
    await expect(yard).toHaveAttribute('aria-pressed', 'true');
    expect(await yaw()).toBe(0);

    // Q is still held, but the glance it started ended with looking around.
    await sheet(page).getByText(en.graphicsHigh, { exact: true }).click();
    await expect(chase).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r));
    });
    expect(await yaw()).toBe(0);
    await page.keyboard.up('KeyQ');
    await chase.click();
    await expect(free).toHaveAttribute('aria-pressed', 'false');
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

// Headless pages stay visible, so the tab state is emulated.
const setVisibility = (page: Page, state: 'hidden' | 'visible'): Promise<void> =>
  page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

test('a hidden tab pauses the run and the sheet stays open on return', async ({ page }) => {
  await startAndRoll(page);
  await setVisibility(page, 'hidden');
  await expect(sheet(page)).toBeVisible();
  const pausedAt = await clock(page).textContent();

  await setVisibility(page, 'visible');
  await page.waitForTimeout(600);
  await expect(sheet(page)).toBeVisible();
  await expect(clock(page)).toHaveText(pausedAt ?? '');

  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect(clock(page)).not.toHaveText(pausedAt ?? '');
});

test('a hidden tab leaves an open sheet as it is', async ({ page }) => {
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  await expect(speed(page)).toHaveText('0.0 km/h');
  await page.keyboard.press('Escape');
  await openSettings(page);

  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect(sheet(page)).toHaveCount(1);
  await expect(sheet(page).getByRole('heading', { name: en.settings })).toBeVisible();
});

test('a hidden tab pauses the free yard too', async ({ page }) => {
  await page.goto('./');
  await startYard(page, en, 'depot');
  await expect(speed(page)).toHaveText('0.0 km/h'); // the drive has mounted
  await setVisibility(page, 'hidden');
  await expect(sheet(page)).toBeVisible();
});

test('a hidden tab after leaving the run builds no sheet', async ({ page }) => {
  // A leaked listener would build its sheet on the detached stage, where no locator sees it.
  await page.addInitScript(() => {
    let built = 0;
    Object.defineProperty(window, 'sheetsBuilt', { get: () => built });
    const append = Object.getOwnPropertyDescriptor(Element.prototype, 'append')?.value as (
      ...nodes: (Node | string)[]
    ) => void;
    Element.prototype.append = function (this: Element, ...nodes: (Node | string)[]): void {
      if (nodes.some((n) => n instanceof Element && n.classList.contains('pause-sheet'))) built++;
      append.apply(this, nodes);
    };
  });
  const built = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { sheetsBuilt: number }).sheetsBuilt);
  await page.goto('./');
  await startAndRoll(page);
  await page.keyboard.press('Escape');
  await sheet(page).getByRole('button', { name: en.leaveUnscored }).click();
  await toTitle(page, en);

  const before = await built();
  expect(before).toBeGreaterThan(0);
  await setVisibility(page, 'hidden');
  expect(await built()).toBe(before);
});
