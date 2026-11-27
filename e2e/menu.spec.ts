import type { Locator, Page } from '@playwright/test';
import { EXERCISE_BRIEF, EXERCISE_TITLE, LAYOUT_NAME } from '../src/app/entry-keys';
import { exerciseById } from '../src/content/registry';
import { EXERCISE_IDS, type ExerciseId } from '../src/contracts/exercise';
import { LAYOUT_IDS } from '../src/contracts/layout';
import { TRAILER_IDS, TRUCK_IDS } from '../src/contracts/vehicle';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { trailers, trucks } from '../src/vehicles/registry';
import { expect, test } from './fixtures';
import {
  chooseRunOption,
  chooseSetting,
  exerciseEntry,
  openSetup,
  settingValue,
  setupBests,
  startControl,
  startEntry,
  yardEntry,
} from './menu-flow';
import { reachedResult, seedStorage } from './menu-seed';
import { SETTINGS_KEY } from './pinned-shoot';

const screen = (page: Page, id: string): Locator => page.locator(`[data-screen="${id}"]`);
const titleEntry = (page: Page, name: string): Locator =>
  screen(page, 'title').getByRole('button', { name });
const historyState = (page: Page): Promise<unknown> =>
  page.evaluate(() => history.state as unknown);

const [truckId] = TRUCK_IDS;
const [trailerId] = TRAILER_IDS;

const [, arocs] = TRUCK_IDS;
const [, hueffermann] = TRAILER_IDS;
const night = { lighting: 'night', mirrorsOnly: true } as const;
const exerciseRef = (id: ExerciseId): object => ({ role: 'driver', kind: 'exercise', id });
const rowOf = (page: Page, key: string): Locator => page.locator(`[data-entry="driver:${key}"]`);

test.describe('the longest title footer', () => {
  // Registration fails without a worker: the footer says so and a toast offers to dismiss it.
  test.use({ serviceWorkers: 'block' });

  for (const { locale, messages } of [
    { locale: 'en-US', messages: en },
    { locale: 'de-DE', messages: de },
  ]) {
    test(`the title fits 1280x585 in ${locale} with Continue, a run to replay and every footer item`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        locale,
        viewport: { width: 1280, height: 585 },
        serviceWorkers: 'block',
      });
      const exerciseId = 'reverse-bay';
      // the Einweiser's lines are the longest: his exercise title or yard name, and his role
      const guides = [
        ...EXERCISE_IDS.map((id) => ({
          entry: { role: 'einweiser', kind: 'exercise', id },
          heading: `${String(EXERCISE_IDS.indexOf(id) + 1)} ${messages[EXERCISE_TITLE.einweiser[id]]}`,
          context: messages[EXERCISE_TITLE.einweiser[id]],
          role: [],
        })),
        ...LAYOUT_IDS.map((id) => {
          const context = `${messages.freeYard} · ${messages[LAYOUT_NAME[id]]}`;
          return {
            entry: { role: 'einweiser', kind: 'yard', id },
            heading: context,
            context,
            role: [messages.roleEinweiser],
          };
        }),
      ];
      const longest = (by: (g: (typeof guides)[number]) => string) =>
        guides.reduce((a, b) => (by(b).length > by(a).length ? b : a));
      const resumed = longest((g) => g.heading);
      const replayed = longest((g) => [g.context, ...g.role].join(' · '));
      await seedStorage(context, {
        settings: {
          truckId: arocs,
          trailerId: hueffermann,
          ...night,
          lastEntry: resumed.entry,
        },
        lastRun: { layoutId: exerciseById(exerciseId).layout, exerciseId, truckId, trailerId },
      });
      const page = await context.newPage();
      await page.goto('./');
      await expect(titleEntry(page, messages.continue)).toBeVisible();
      await expect(titleEntry(page, messages.replayLastRun)).toBeVisible();
      await expect(titleEntry(page, messages.continue)).toContainText(resumed.heading);
      // an Einweiser run is not seeded here (its log needs his track): give the replay his line
      await titleEntry(page, messages.replayLastRun)
        .locator('.menu-item-detail')
        .evaluate(
          (el, text) => {
            el.textContent = text;
          },
          [
            replayed.context,
            ...replayed.role,
            messages.lightingNight,
            messages.einweiserViewNoTop,
          ].join(' · '),
        );
      await expect(titleEntry(page, messages.controls)).toBeVisible();
      await expect(titleEntry(page, messages.whatsNew)).toBeVisible();
      await expect(titleEntry(page, messages.about)).toBeVisible();
      const footer = screen(page, 'title').locator('.menu-footer');
      await expect(footer.locator('[data-menu="offline"]')).toHaveText(messages.offlineSetupFailed);
      // The offline project builds the production channel and a development label: force the rest.
      await footer.evaluate(
        (el, [build, uat]) => {
          const label = el.querySelector('[data-menu="build"]');
          if (label === null) throw new Error('footer markup missing');
          label.textContent = build ?? '';
          if (el.querySelector('[data-menu="channel"]') === null) {
            const badge = document.createElement('span');
            badge.className = 'menu-badge';
            badge.dataset['menu'] = 'channel';
            badge.textContent = uat ?? '';
            label.after(badge);
          }
        },
        [messages.buildDevelopment.replace('{commit}', '0123abc'), messages.channelUat],
      );
      await page.evaluate(() => document.fonts.ready);

      const overflow = (): Promise<number> =>
        page.evaluate(() => {
          const root = document.scrollingElement;
          const scroll = document.querySelector('[data-screen="title"] .menu-screen-scroll');
          if (root === null || scroll === null) throw new Error('title markup missing');
          return Math.max(...[root, scroll].map((el) => el.scrollHeight - el.clientHeight));
        });
      const toast = page.locator('.update-toast');
      await expect(toast).toBeVisible();
      const reserve = (): Promise<number> =>
        page.evaluate(
          () =>
            parseFloat(
              getComputedStyle(document.querySelector('#app') ?? document.body).getPropertyValue(
                '--toast-reserve',
              ),
            ) || 0,
        );
      // The reserve follows the toast through a ResizeObserver, so it settles after the toast shows.
      await expect.poll(reserve).toBeGreaterThan(0);
      expect(await overflow()).toBeLessThanOrEqual(await reserve());

      await toast.getByRole('button', { name: messages.dismiss }).click();
      await expect(toast).toBeHidden();
      await expect.poll(overflow).toBe(0);
      await context.close();
    });
  }
});

test('Continue names the exercise, truck, trailer, time of day and driving view', async ({
  page,
}) => {
  await seedStorage(page, {
    settings: {
      truckId: arocs,
      trailerId: hueffermann,
      ...night,
      lastEntry: exerciseRef('reverse-corner'),
    },
  });
  await page.goto('./');
  const button = titleEntry(page, en.continue);
  for (const part of [
    en.exerciseReverseCorner,
    trucks.find((s) => s.id === arocs)?.name ?? '',
    trailers.find((s) => s.id === hueffermann)?.name ?? '',
    en.lightingNight,
    en.driveViewMirrors,
  ]) {
    expect(part).not.toBe('');
    await expect(button).toContainText(part);
  }
  await expect(button).toBeFocused();
});

test('Continue moves past a done exercise, wraps, and keeps the last one when all are done', async ({
  browser,
}) => {
  const cases: readonly {
    last: ExerciseId;
    done: readonly ExerciseId[];
    shows: ExerciseId;
  }[] = [
    { last: 'reverse-bay', done: ['reverse-bay'], shows: 'reverse-corner' },
    { last: 'slalom', done: ['slalom', 'straight-reverse'], shows: 'reverse-bay' },
    { last: 'reverse-bay', done: EXERCISE_IDS, shows: 'reverse-bay' },
  ];
  for (const { last, done, shows } of cases) {
    const context = await browser.newContext();
    await seedStorage(context, {
      settings: { lastEntry: exerciseRef(last) },
      best: done.map(reachedResult),
    });
    const page = await context.newPage();
    await page.goto('./');
    await expect(titleEntry(page, en.continue)).toContainText(en[EXERCISE_TITLE.driver[shows]]);
    await context.close();
  }
});

test('a first visit shows no Continue and focuses Exercises', async ({ page }) => {
  await page.goto('./');
  await expect(titleEntry(page, en.exercises)).toBeFocused();
  await expect(titleEntry(page, en.continue)).toHaveCount(0);
  await expect(titleEntry(page, en.replayLastRun)).toHaveCount(0);
});

test("the exercise list focuses Continue's exercise, and the yard list the last driven yard", async ({
  browser,
}) => {
  const exercise = await browser.newContext();
  // Done, so Continue moves on to the slalom: the list follows Continue, not the last entry.
  await seedStorage(exercise, {
    settings: { lastEntry: exerciseRef('dock-ramp') },
    best: [reachedResult('dock-ramp')],
  });
  const exercisePage = await exercise.newPage();
  await exercisePage.goto('./');
  await titleEntry(exercisePage, en.exercises).click();
  await expect(rowOf(exercisePage, 'exercise:slalom')).toBeFocused();
  await exercise.close();

  const yard = await browser.newContext();
  await seedStorage(yard, {
    settings: { lastEntry: { role: 'driver', kind: 'yard', id: 'logistics' } },
  });
  const yardPage = await yard.newPage();
  await yardPage.goto('./');
  await screen(yardPage, 'title').getByRole('button', { name: en.freeYard, exact: true }).click();
  await expect(rowOf(yardPage, 'yard:logistics')).toBeFocused();
  await yard.close();
});

test('the exercise list holds one row per exercise in curriculum order, with brief and done marker', async ({
  page,
}) => {
  const done: ExerciseId = 'straight-reverse';
  await seedStorage(page, { best: [reachedResult(done)] });
  await page.goto('./');
  await titleEntry(page, en.exercises).click();

  const rows = screen(page, 'exercises').locator('ol > li');
  await expect(rows).toHaveCount(EXERCISE_IDS.length);
  for (const [index, id] of EXERCISE_IDS.entries()) {
    const row = rows.nth(index);
    await expect(row.getByRole('button')).toHaveCount(1);
    await expect(row).toContainText(en[EXERCISE_TITLE.driver[id]]);
    await expect(row).toContainText(en[EXERCISE_BRIEF.driver[id]]);
    if (id === done) await expect(row).toContainText(`✓ ${en.exerciseDone}`);
    else await expect(row).not.toContainText(en.exerciseDone);
  }
  await expect(rows.nth(EXERCISE_IDS.indexOf('reverse-bay')).getByRole('button')).toBeFocused();
});

test('arrow keys, Home and End move within the title and the list and stop at the ends', async ({
  page,
}) => {
  await page.goto('./');
  const entries = [en.exercises, en.freeYard, en.settings, en.controls, en.whatsNew, en.about].map(
    (name) => titleEntry(page, name),
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

test('Forward onto the popped list entry is undone and one Back still leaves', async ({ page }) => {
  await page.goto('./');
  await titleEntry(page, en.exercises).click();
  await expect(screen(page, 'exercises')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(screen(page, 'title')).toBeVisible();
  await expect.poll(() => historyState(page)).toBeNull();
  await page.goForward();
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

test('Enter alone walks from the title to a focused Start', async ({ page }) => {
  await page.goto('./');
  await expect(titleEntry(page, en.exercises)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(screen(page, 'exercises')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(startControl(page, en, exerciseEntry('straight-reverse'))).toBeFocused();
  await expect(screen(page, 'setup').getByRole('heading', { level: 1 })).toHaveText(
    `1 ${en.exerciseStraightReverse}`,
  );
});

test('focus returns to the row that opened setup, then to the opener on the title', async ({
  page,
}) => {
  await page.goto('./');
  const open = titleEntry(page, en.exercises);
  await open.click();
  const row = screen(page, 'exercises').getByRole('button', {
    name: new RegExp(`^${en.exerciseReverseCorner}`),
  });
  await row.click();
  await expect(screen(page, 'setup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
});

test('Esc and goBack step one level each from setup to the title', async ({ page }) => {
  const entry = exerciseEntry('reverse-bay');
  await page.goto('./');
  await openSetup(page, en, entry);
  await page.keyboard.press('Escape');
  await expect(screen(page, 'exercises')).toBeVisible();
  await expect.poll(() => historyState(page)).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect(screen(page, 'title')).toBeVisible();
  await expect.poll(() => historyState(page)).toBeNull();

  await openSetup(page, en, entry);
  await page.goBack();
  await expect(screen(page, 'exercises')).toBeVisible();
  await expect.poll(() => historyState(page)).not.toBeNull();
  await page.goBack();
  await expect(screen(page, 'title')).toBeVisible();
  await expect.poll(() => historyState(page)).toBeNull();
});

test('setup shows the stored run options checked and stores a change', async ({ page }) => {
  await seedStorage(page, {
    settings: { truckId: arocs, trailerId: hueffermann, lighting: 'night', mirrorsOnly: true },
  });
  const entry = exerciseEntry('straight-reverse');
  const radio = (group: string, value: string): Locator =>
    screen(page, 'setup')
      .getByRole('radiogroup', { name: group, exact: true })
      .locator(`input[value="${value}"]`);
  await page.goto('./');
  await openSetup(page, en, entry);
  await expect(radio(en.truck, arocs)).toBeChecked();
  await expect(radio(en.trailer, hueffermann)).toBeChecked();
  await expect(radio(en.lighting, 'night')).toBeChecked();
  await expect(radio(en.driveView, 'mirrors')).toBeChecked();
  await expect(radio(en.role, 'driver')).toBeChecked();

  await chooseRunOption(page, en, 'lighting', 'day');
  await page.reload();
  await openSetup(page, en, entry);
  await expect(radio(en.lighting, 'day')).toBeChecked();
  await expect(radio(en.truck, arocs)).toBeChecked();
});

test('the role row names the Einweiser entry his way and hides the driver bests', async ({
  page,
}) => {
  await page.goto('./');
  const entry = exerciseEntry('straight-reverse');
  await openSetup(page, en, entry);
  const setup = screen(page, 'setup');
  const heading = setup.getByRole('heading', { level: 1 });
  const view = setup.getByRole('radiogroup', { name: en.einweiserView, exact: true });
  await expect(setupBests(page, en, entry)).toBeVisible();
  await expect(view).toHaveCount(0);

  await setup.locator('[data-menu="role"] input[value="einweiser"]').click();
  await expect(heading).toHaveText(`1 ${en.guideStraightReverse}`);
  await expect(setup).toContainText(en.guideBriefStraightReverse);
  await expect(setup.locator('[data-menu="bests"]')).toHaveCount(0);
  await expect(view).toContainText(en.einweiserViewNoTop);

  await setup.locator('[data-menu="role"] input[value="driver"]').click();
  await expect(heading).toHaveText(`1 ${en.exerciseStraightReverse}`);
  await expect(setupBests(page, en, entry)).toBeVisible();
});

test('the role row starts an Einweiser drive, records its entry and opens on it next time', async ({
  page,
}) => {
  await seedStorage(page, { settings: { graphics: 'low' } });
  await page.goto('./');
  const entry = { ...yardEntry('depot'), role: 'einweiser' } as const;
  await openSetup(page, en, entry);
  const row = screen(page, 'setup').getByRole('radiogroup', { name: en.role, exact: true });
  await expect(row.locator('input:checked')).toHaveValue('driver');
  await startEntry(page, en, entry);
  await expect(page.locator('.drive[data-role="einweiser"]')).toBeAttached();
  const lastEntry = await page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key) ?? '{}') as { lastEntry?: unknown }).lastEntry,
    SETTINGS_KEY,
  );
  expect(lastEntry).toEqual({ role: 'einweiser', kind: 'yard', id: 'depot' });

  await page.reload();
  await openSetup(page, en, yardEntry('logistics'));
  await expect(row.locator('input:checked')).toHaveValue('einweiser');
});

test('an Einweiser exercise plays from the menu to his result, and the title continues and replays it', async ({
  page,
}) => {
  await seedStorage(page, { settings: { graphics: 'low' } });
  await page.goto('./');
  await startEntry(page, en, { ...exerciseEntry('straight-reverse'), role: 'einweiser' });
  await expect(page.locator('.drive[data-role="einweiser"]')).toBeAttached();
  await expect(page.locator('[data-hud="goalTitle"]')).toHaveText(en.guideStraightReverse);
  // the run time starts with the driver's first drive input: Herkommen from behind reverses him
  const time = page.locator('[data-hud="time"]');
  const still = await time.textContent();
  await page.keyboard.press('Digit1');
  await page.keyboard.down('Digit5');
  await expect(time).not.toHaveText(still ?? '');
  await page.keyboard.up('Digit5');
  await page.keyboard.press('Digit2');

  await page.getByRole('button', { name: en.pause }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();
  await expect(page.locator('.result-eyebrow').first()).toHaveText(
    `${en.result} · ${en.guideStraightReverse}`,
  );
  const faults = page.getByRole('region', { name: en.roleEinweiser });
  await expect(faults.locator('.result-row')).toHaveCount(7);
  await expect(faults).toContainText(en.basisTrainer);
  const best = await page.evaluate(() => localStorage.getItem('gegenlenker.best.v2'));
  expect(best).toBeNull();

  await page.getByRole('button', { name: en.menu }).click();
  await expect(titleEntry(page, en.continue)).toContainText(en.guideStraightReverse);
  await expect(titleEntry(page, en.continue)).not.toContainText(en.roleEinweiser);
  await expect(titleEntry(page, en.replayLastRun)).toContainText(en.guideStraightReverse);
  await expect(titleEntry(page, en.replayLastRun)).not.toContainText(en.roleEinweiser);
  await titleEntry(page, en.continue).click();
  await expect(page.locator('.drive[data-role="einweiser"]')).toBeAttached();
});

test('a touch device offers no role and no Einweiser settings, and continues an Einweiser entry as the driver', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    await seedStorage(context, {
      settings: { lastEntry: { role: 'einweiser', kind: 'exercise', id: 'reverse-bay' } },
    });
    const page = await context.newPage();
    await page.goto('./');
    await expect(titleEntry(page, en.continue)).toContainText(en.exerciseReverseBay);
    await expect(titleEntry(page, en.continue)).not.toContainText(en.roleEinweiser);
    await openSetup(page, en, exerciseEntry('reverse-bay'));
    await expect(screen(page, 'setup').locator('[data-menu="role"]')).toHaveCount(0);
    await page.goBack();
    await page.goBack();
    await titleEntry(page, en.settings).click();
    await expect(screen(page, 'settings')).toContainText(en.settingsGraphics);
    await expect(screen(page, 'settings')).not.toContainText(en.settingsEinweiser);
  } finally {
    await context.close();
  }
});

test("a yard's setup shows no tolerance and no bests", async ({ page }) => {
  await page.goto('./');
  await openSetup(page, en, yardEntry('depot'));
  const setup = screen(page, 'setup');
  await expect(setup.getByRole('heading', { level: 1 })).toHaveText(
    `${en.freeYard} · ${en.layoutDepot}`,
  );
  await expect(setup).toContainText(en.briefDepot);
  await expect(setup).not.toContainText(en.tolerance);
  await expect(setupBests(page, en, yardEntry('depot'))).toHaveCount(0);
  await expect(setup).not.toContainText(en.noResult);
});

test('the last row and Start can be reached at 1280x585 in German, with Back and the heading in view', async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: 'de-DE',
    viewport: { width: 1280, height: 585 },
  });
  const page = await context.newPage();
  const entry = exerciseEntry('slalom');
  await page.goto('./');
  await openSetup(page, de, entry);
  const setup = screen(page, 'setup');
  const last = setup.getByRole('radiogroup', { name: de.driveView, exact: true });
  const start = startControl(page, de, entry);
  for (const target of [last, start]) {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
    await expect(setup.getByRole('button', { name: de.back })).toBeInViewport();
    await expect(setup.getByRole('heading', { level: 1 })).toBeInViewport();
  }
  await context.close();
});

const settingsRadio = (page: Page, group: string, value: string): Locator =>
  screen(page, 'settings')
    .getByRole('radiogroup', { name: group, exact: true })
    .locator(`input[value="${value}"]`);

test('a language change re-renders Settings in place, keeps focus on the chosen value, and Back returns to the title in that language', async ({
  page,
}) => {
  await page.goto('./');
  await titleEntry(page, en.settings).click();
  await expect(settingsRadio(page, en.language, 'en')).toBeFocused();
  await settingsRadio(page, en.language, 'de').click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(settingsRadio(page, de.language, 'de')).toBeFocused();
  await expect(screen(page, 'settings').getByRole('heading', { level: 1 })).toHaveText(de.settings);
  await expect.poll(() => historyState(page)).not.toBeNull();
  await screen(page, 'settings').getByRole('button', { name: de.back }).click();
  await expect(titleEntry(page, de.exercises)).toBeVisible();
  await expect.poll(() => historyState(page)).toBeNull();
});

test('a Settings change applies at once and survives a reload', async ({ page }) => {
  await page.goto('./');
  await titleEntry(page, en.settings).click();
  await expect(settingsRadio(page, en.theme, 'system')).toBeChecked();
  await settingsRadio(page, en.theme, 'dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await titleEntry(page, en.settings).click();
  await expect(settingsRadio(page, en.theme, 'dark')).toBeChecked();
});

test('Settings stores every change and the helpers read it back', async ({ page }) => {
  await page.goto('./');
  await chooseSetting(page, en, 'graphics', 'low');
  await chooseSetting(page, en, 'wideMirrors', 'off');
  await page.reload();
  expect(await settingValue(page, en, 'graphics')).toBe('low');
  expect(await settingValue(page, en, 'wideMirrors')).toBe('off');
});

test('no screen overflows sideways at 360 px', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page = await context.newPage();
  const fits = async (id: string): Promise<void> => {
    await expect(screen(page, id)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const over = await page.evaluate((screenId) => {
      const scroll = document.querySelector(`[data-screen="${screenId}"] .menu-screen-scroll`);
      if (scroll === null || document.scrollingElement === null) throw new Error('no screen');
      return [document.scrollingElement, scroll].map((el) => el.scrollWidth - el.clientWidth);
    }, id);
    for (const extra of over) expect(extra, id).toBeLessThanOrEqual(0);
  };
  await page.goto('./');
  await fits('title');
  await titleEntry(page, en.exercises).click();
  await fits('exercises');
  await openSetup(page, en, exerciseEntry('slalom'));
  await fits('setup');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await titleEntry(page, en.freeYard).click();
  await fits('yards');
  await openSetup(page, en, yardEntry('depot'));
  await fits('setup');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await titleEntry(page, en.settings).click();
  await fits('settings');
  await page.keyboard.press('Escape');
  await titleEntry(page, en.whatsNew).click();
  await expect(screen(page, 'whatsNew').getByRole('listitem').first()).toBeVisible();
  await fits('whatsNew');
  await context.close();
});

test('the last Settings row can be reached at 1280x585 in German, with Back and the heading in view', async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: 'de-DE',
    viewport: { width: 1280, height: 585 },
  });
  const page = await context.newPage();
  await page.goto('./');
  await titleEntry(page, de.settings).click();
  const settings = screen(page, 'settings');
  const last = settings.getByRole('radiogroup', { name: de.wideMirrors, exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(settings.getByRole('button', { name: de.back })).toBeInViewport();
  await expect(settings.getByRole('heading', { level: 1 })).toBeInViewport();
  await context.close();
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
