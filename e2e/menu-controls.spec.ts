import type { Locator, Page } from '@playwright/test';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { expect, test } from './fixtures';
import { seedStorage } from './menu-seed';

const screen = (page: Page, id: string): Locator => page.locator(`[data-screen="${id}"]`);
const controls = (page: Page): Locator => screen(page, 'controls');
const heading = (page: Page): Locator => controls(page).getByRole('heading', { level: 1 });
const keys = (page: Page): Locator =>
  controls(page).getByRole('region', { name: en.controlsKeyboard });
const touch = (page: Page): Locator =>
  controls(page).getByRole('region', { name: en.controlsTouch });
const historyState = (page: Page): Promise<unknown> =>
  page.evaluate(() => history.state as unknown);

test.describe('the Controls screen', () => {
  test('Controls opens from the title and from Settings, with its heading focused, and Back returns to each opener', async ({
    page,
  }) => {
    await page.goto('./');
    const fromTitle = screen(page, 'title').getByRole('button', {
      name: en.controls,
      exact: true,
    });
    await fromTitle.click();
    await expect(heading(page)).toHaveText(en.controls);
    await expect(heading(page)).toBeFocused();
    await controls(page).getByRole('button', { name: en.back }).click();
    await expect(fromTitle).toBeFocused();
    await expect.poll(() => historyState(page)).toBeNull();

    await screen(page, 'title').getByRole('button', { name: en.settings, exact: true }).click();
    const fromSettings = screen(page, 'settings').getByRole('button', {
      name: en.controls,
      exact: true,
    });
    await fromSettings.click();
    await expect(heading(page)).toBeFocused();
    await expect(screen(page, 'settings')).toHaveCount(0);
    await controls(page).getByRole('button', { name: en.back }).click();
    await expect(screen(page, 'settings')).toBeVisible();
    await expect(fromSettings).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(screen(page, 'title')).toBeVisible();
  });

  test('the keyboard group lists the drive legend rows for the saved graphics and driving view', async ({
    browser,
  }) => {
    const open = async (settings: object): Promise<Page> => {
      const context = await browser.newContext();
      await seedStorage(context, { settings });
      const page = await context.newPage();
      await page.goto('./');
      await screen(page, 'title').getByRole('button', { name: en.controls, exact: true }).click();
      await expect(keys(page)).toBeVisible();
      return page;
    };
    const term = (page: Page, text: string): Locator =>
      keys(page).locator('dt').getByText(text, { exact: true });

    const low = await open({ graphics: 'low', mirrorsOnly: false });
    await expect(term(low, 'F / Y')).toHaveCount(1);
    await expect(term(low, 'F / Y / O')).toHaveCount(0);
    await expect(term(low, 'Q / E')).toHaveCount(0);
    await low.context().close();

    const high = await open({ graphics: 'high', mirrorsOnly: true });
    await expect(term(high, 'Q / E')).toHaveCount(1);
    await expect(keys(high)).not.toContainText(en.viewSwitch);
    await high.context().close();

    const top = await open({ graphics: 'high', mirrorsOnly: false });
    await expect(term(top, 'F / Y / O')).toHaveCount(1);
    await expect(keys(top)).toContainText(en.viewSwitch);
    await top.context().close();
  });

  test('the touch group names wheel, lever, Stop and the buttons', async ({ page }) => {
    await page.goto('./');
    await screen(page, 'title').getByRole('button', { name: en.controls, exact: true }).click();
    const group = touch(page);
    await expect(group.locator('dt')).toHaveText([
      en.touchWheel,
      en.touchLever,
      en.stop,
      en.touchButtons,
    ]);
    await expect(group.locator('dd')).toHaveText([
      en.touchWheelUse,
      en.touchLeverUse,
      en.touchStopUse,
      en.touchButtonsUse,
    ]);
    await expect(group).toContainText(en.touchTwoThumbs);
  });

  test('no sideways overflow at 360 px, and the last row can be reached at 1280x585 in German', async ({
    browser,
  }) => {
    const narrow = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const small = await narrow.newPage();
    await small.goto('./');
    await screen(small, 'title').getByRole('button', { name: en.controls, exact: true }).click();
    await expect(touch(small)).toBeVisible();
    await small.evaluate(() => document.fonts.ready);
    const over = await small.evaluate(() => {
      const scroll = document.querySelector('[data-screen="controls"] .menu-screen-scroll');
      if (scroll === null || document.scrollingElement === null) throw new Error('no screen');
      return [document.scrollingElement, scroll].map((el) => el.scrollWidth - el.clientWidth);
    });
    for (const extra of over) expect(extra).toBeLessThanOrEqual(0);
    await narrow.close();

    const laptop = await browser.newContext({
      locale: 'de-DE',
      viewport: { width: 1280, height: 585 },
    });
    const page = await laptop.newPage();
    await page.goto('./');
    await screen(page, 'title').getByRole('button', { name: de.controls, exact: true }).click();
    const last = controls(page).getByText(de.touchTwoThumbs);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(controls(page).getByRole('button', { name: de.back })).toBeInViewport();
    await expect(heading(page)).toBeInViewport();
    await laptop.close();
  });
});
