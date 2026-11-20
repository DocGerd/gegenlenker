import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { loadFragments, loadReleases } from '../tools/changelog';

const dir = resolve(import.meta.dirname, '../changelog.d');
const entryCount =
  loadFragments(dir).length +
  (loadReleases(dir) as { entries: unknown[] }[]).reduce((n, { entries }) => n + entries.length, 0);

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
