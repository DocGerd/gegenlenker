import type { Locator, Page } from '@playwright/test';
import { EXERCISE_BRIEF, EXERCISE_TITLE } from '../src/app/entry-keys';
import { exerciseById } from '../src/content/registry';
import { EXERCISE_IDS, type ExerciseId, type RunResult } from '../src/contracts/exercise';
import { TRAILER_IDS, TRUCK_IDS } from '../src/contracts/vehicle';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { expect, test } from './fixtures';
import { seedStorage } from './menu-seed';

const screen = (page: Page, id: string): Locator => page.locator(`[data-screen="${id}"]`);
const titleEntry = (page: Page, name: string): Locator =>
  screen(page, 'title').getByRole('button', { name });
const historyState = (page: Page): Promise<unknown> =>
  page.evaluate(() => history.state as unknown);

const [truckId] = TRUCK_IDS;
const [trailerId] = TRAILER_IDS;

const reached = (exerciseId: ExerciseId): RunResult => ({
  exerciseId,
  truckId,
  trailerId,
  reached: true,
  assisted: false,
  lighting: 'day',
  mirrorsOnly: false,
  waypointMissed: false,
  positionError: 0.1,
  angleError: 0.01,
  contacts: 0,
  jackknifes: 0,
  directionChanges: 1,
  time: 42.5,
});

for (const { locale, messages } of [
  { locale: 'en-US', messages: en },
  { locale: 'de-DE', messages: de },
]) {
  test(`the title fits 1280x585 in ${locale} with a run to replay`, async ({ browser }) => {
    const context = await browser.newContext({ locale, viewport: { width: 1280, height: 585 } });
    const exerciseId = 'reverse-bay';
    await seedStorage(context, {
      lastRun: { layoutId: exerciseById(exerciseId).layout, exerciseId, truckId, trailerId },
    });
    const page = await context.newPage();
    await page.goto('./');
    await expect(titleEntry(page, messages.replayLastRun)).toBeVisible();
    await expect(titleEntry(page, messages.whatsNew)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const [over, reserve] = await page.evaluate(() => {
      const root = document.scrollingElement;
      const scroll = document.querySelector('[data-screen="title"] .menu-screen-scroll');
      const app = document.querySelector('#app');
      if (root === null || scroll === null || app === null) throw new Error('title markup missing');
      const r = getComputedStyle(app).getPropertyValue('--toast-reserve');
      return [
        Math.max(...[root, scroll].map((el) => el.scrollHeight - el.clientHeight)),
        parseFloat(r) || 0,
      ];
    });
    expect(over).toBeLessThanOrEqual(reserve);
    await context.close();
  });
}

test('the exercise list holds one row per exercise in curriculum order, with brief and done marker', async ({
  page,
}) => {
  const done: ExerciseId = 'straight-reverse';
  await seedStorage(page, { best: [reached(done)] });
  await page.goto('./');
  await titleEntry(page, en.exercises).click();

  const rows = screen(page, 'exercises').locator('ol > li');
  await expect(rows).toHaveCount(EXERCISE_IDS.length);
  for (const [index, id] of EXERCISE_IDS.entries()) {
    const row = rows.nth(index);
    await expect(row.getByRole('button')).toHaveCount(1);
    await expect(row).toContainText(en[EXERCISE_TITLE[id]]);
    await expect(row).toContainText(en[EXERCISE_BRIEF[id]]);
    if (id === done) await expect(row).toContainText(`✓ ${en.exerciseDone}`);
    else await expect(row).not.toContainText(en.exerciseDone);
  }
  await expect(rows.nth(EXERCISE_IDS.indexOf('reverse-bay')).getByRole('button')).toBeFocused();
});

test('arrow keys, Home and End move within the title and the list and stop at the ends', async ({
  page,
}) => {
  await page.goto('./');
  const entries = [en.exercises, en.freeYard, en.settings, en.whatsNew].map((name) =>
    titleEntry(page, name),
  );
  const [first] = entries;
  const last = entries.at(-1);
  if (first === undefined || last === undefined) throw new Error('no title entries');
  await expect(first).toBeFocused();
  for (const entry of entries.slice(1)) {
    await page.keyboard.press('ArrowDown');
    await expect(entry).toBeFocused();
  }
  await page.keyboard.press('ArrowDown');
  await expect(last).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
  await page.keyboard.press('End');
  await expect(last).toBeFocused();

  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  const rows = screen(page, 'exercises').getByRole('listitem').getByRole('button');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
});

test('Esc and goBack step from a list to the title, and goBack on the title leaves', async ({
  page,
}) => {
  await page.goto('./');
  const open = titleEntry(page, en.exercises);
  await open.click();
  await expect(screen(page, 'exercises')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await expect.poll(() => historyState(page)).toBeNull();
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await expect.poll(() => historyState(page)).toBeNull();

  await open.click();
  await expect(screen(page, 'exercises')).toBeVisible();
  await page.goBack();
  await expect(open).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('a reload on a list shows the title and the next goBack leaves', async ({ page }) => {
  await page.goto('./');
  await titleEntry(page, en.freeYard).click();
  await expect(screen(page, 'yards')).toBeVisible();
  await page.reload();
  await expect(screen(page, 'title')).toBeVisible();
  await expect.poll(() => historyState(page)).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('a held Enter opens one screen only', async ({ page }) => {
  await page.goto('./');
  await expect(titleEntry(page, en.exercises)).toBeFocused();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(screen(page, 'exercises')).toBeVisible();
  await expect(screen(page, 'setup')).toHaveCount(0);
});

test('a double click on a title entry moves one level', async ({ page }) => {
  await page.goto('./');
  const open = titleEntry(page, en.exercises);
  const box = await open.boundingBox();
  if (box === null) throw new Error('the Exercises entry has no box');
  await open.dblclick();
  await expect(screen(page, 'exercises')).toBeVisible();
  await expect(screen(page, 'setup')).toHaveCount(0);
  // The second click landed on a row, so the guard, not the layout, kept the list.
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const under = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-screen] button')?.className,
    point,
  );
  expect(under).toContain('menu-row');
});

test.describe('a content chunk that fails to load', () => {
  // A service worker would answer the chunk request itself, past page.route.
  test.use({ serviceWorkers: 'block' });

  test("shows the load-failure notice; Back lands on the title and Retry reopens What's new", async ({
    page,
    allow,
  }) => {
    allow(/net::ERR_FAILED|Failed to fetch dynamically imported module: .*\/assets\/whats-new-/);
    let offline = true;
    await page.route(
      (url) =>
        /\/assets\/whats-new-/.test(url.pathname) && !url.pathname.includes('whats-new-seen-'),
      async (route) => {
        if (offline) await route.abort();
        else await route.continue();
      },
    );
    const notice = page.getByRole('alertdialog', { name: en.loadFailed });
    const open = titleEntry(page, en.whatsNew);

    await page.goto('./');
    await open.click();
    await expect(notice).toBeVisible();
    await expect(screen(page, 'whatsNew')).toHaveCount(0);
    await notice.getByRole('button', { name: en.back }).click();
    await expect(screen(page, 'title')).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect.poll(() => historyState(page)).toBeNull();

    await open.click();
    await expect(notice).toBeVisible();
    offline = false;
    await notice.getByRole('button', { name: en.retry }).click();
    await expect(page.getByRole('heading', { level: 1, name: en.whatsNew })).toBeFocused();
    await expect(screen(page, 'whatsNew').getByRole('listitem').first()).toBeVisible();
    await expect.poll(() => historyState(page)).not.toBeNull();
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
    await expect.poll(() => historyState(page)).toBeNull();
  });
});
