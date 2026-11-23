import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { loadFragments, loadReleases } from '../tools/changelog';

const dir = resolve(import.meta.dirname, '../changelog.d');
const SEEN_KEY = 'gegenlenker.whatsNewSeen.v1';
const allEntries = [
  ...loadFragments(dir),
  ...(loadReleases(dir) as { entries: { id: string; en: string }[] }[]).flatMap(
    ({ entries }) => entries,
  ),
];
const entryCount = allEntries.length;
const withheld = allEntries[0];
if (withheld === undefined) throw new Error('the changelog has no entries');

const locales = [
  { locale: 'en-US', messages: en },
  { locale: 'de-DE', messages: de },
];

for (const { locale, messages } of locales) {
  test(`what's new opens from the menu and returns by back gesture in ${locale}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale, viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const requests: string[] = [];
    await page.goto('./');
    const open = page.getByRole('button', { name: messages.whatsNew });
    await expect(open).toBeVisible();

    page.on('request', (r) => {
      if (['fetch', 'xhr'].includes(r.resourceType())) requests.push(r.url());
    });
    await open.click();

    const title = page.getByRole('heading', { level: 1, name: messages.whatsNew });
    await expect(title).toBeFocused();
    expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(0);
    await expect(page.getByRole('listitem')).toHaveCount(entryCount);
    await expect(page.locator('li:not([lang="en"])')).toHaveCount(0);
    await expect(page.getByText(messages.whatsNewEnglishNote)).toHaveCount(
      locale === 'en-US' ? 0 : 1,
    );
    await expect(page.locator('main a')).toHaveCount(0);

    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement;
      const scroll = document.querySelector('.menu-scroll');
      return [root, scroll].map((el) => (el ? el.scrollWidth - el.clientWidth : 0));
    });
    expect(Math.max(...overflow)).toBeLessThanOrEqual(0);
    // The screen's script chunk loads; its content is bundled, so nothing is fetched.
    expect(requests).toEqual([]);

    await page.goBack();
    await expect(page.getByRole('button', { name: messages.whatsNew })).toBeFocused();
    await expect(title).toHaveCount(0);
    await context.close();
  });
}

test("the back button leaves what's new for the menu", async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: en.whatsNew }).click();
  await page.getByRole('button', { name: en.back }).click();
  await expect(page.getByRole('button', { name: en.whatsNew })).toBeFocused();
  await expect(page.getByRole('button', { name: en.exerciseStraightReverse })).toBeVisible();
});

for (const { locale, messages } of locales) {
  test(`a persistent toast never covers the footer controls in ${locale}`, async ({
    browser,
    allow,
  }) => {
    allow(/SW registration failed/);
    const context = await browser.newContext({
      locale,
      viewport: { width: 360, height: 740 },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await page.goto('./');
    const toast = page.locator('.update-toast');
    await expect(toast).toBeVisible();
    await page.getByRole('button', { name: messages.whatsNew }).click({ timeout: 1000 });
    await expect(page.getByRole('heading', { level: 1, name: messages.whatsNew })).toBeVisible();
    await expect(toast).toBeVisible();
    await context.close();
  });
}

for (const { locale, messages } of locales) {
  test(`a new entry is badged until what's new is opened in ${locale}`, async ({ browser }) => {
    const context = await browser.newContext({ locale, viewport: { width: 360, height: 740 } });
    await context.addInitScript(
      ([key, ids]) => {
        try {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(ids));
        } catch {
          // Opaque frames have no storage.
        }
      },
      [SEEN_KEY, allEntries.filter(({ id }) => id !== withheld.id).map(({ id }) => id)] as const,
    );
    const page = await context.newPage();
    await page.goto('./');
    const open = page.getByRole('button', { name: messages.whatsNew });
    await expect(open.getByText(messages.whatsNewBadge, { exact: true })).toBeVisible();

    await open.click();
    await expect(
      page.getByRole('heading', { level: 2, name: messages.whatsNewSince }),
    ).toBeVisible();
    const since = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: messages.whatsNewSince }),
    });
    await expect(since.getByRole('listitem')).toHaveCount(1);
    await expect(since.getByRole('listitem')).toContainText(withheld.en.replace(/`/g, ''));
    await expect(page.getByRole('listitem')).toHaveCount(entryCount);

    await page.goBack();
    await expect(open).toBeFocused();
    await expect(open.getByText(messages.whatsNewBadge, { exact: true })).toBeHidden();
    await open.click();
    await expect(page.getByRole('heading', { level: 1, name: messages.whatsNew })).toBeVisible();
    await expect(page.getByRole('heading', { name: messages.whatsNewSince })).toHaveCount(0);
    await context.close();
  });

  test(`a first visit shows no badge in ${locale}`, async ({ browser }) => {
    const context = await browser.newContext({ locale, viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await page.goto('./');
    const open = page.getByRole('button', { name: messages.whatsNew });
    await expect(open).toBeVisible();
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), SEEN_KEY))
      .not.toBeNull();
    await expect(open.getByText(messages.whatsNewBadge, { exact: true })).toBeHidden();
    await open.click();
    await expect(page.getByRole('heading', { level: 1, name: messages.whatsNew })).toBeVisible();
    await expect(page.getByRole('heading', { name: messages.whatsNewSince })).toHaveCount(0);
    await context.close();
  });
}
