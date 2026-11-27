import type { Locator, Page } from '@playwright/test';
import { assetAuthors, assetKindLabel } from '../src/app/about-credit-text';
import { ABOUT_CREDITS } from '../src/app/about-credits';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { expect, test } from './fixtures';

const locales = [
  { locale: 'en-US', messages: en },
  { locale: 'de-DE', messages: de },
];

const screen = (page: Page, id: string): Locator => page.locator(`[data-screen="${id}"]`);

/** How far the page or the screen's scroll box is wider than it shows. */
const overflow = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const root = document.scrollingElement;
    const scroll = document.querySelector('[data-screen="about"] .menu-screen-scroll');
    if (root === null || scroll === null) throw new Error('about markup missing');
    return Math.max(...[root, scroll].map((el) => el.scrollWidth - el.clientWidth));
  });

for (const { locale, messages } of locales) {
  test(`About opens from the title with its heading focused, fetches nothing, and Esc returns to its entry in ${locale}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale, viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const requests: string[] = [];
    await page.goto('./');
    const open = screen(page, 'title').getByRole('button', { name: messages.about, exact: true });
    await expect(open).toBeVisible();

    page.on('request', (r) => {
      if (['fetch', 'xhr'].includes(r.resourceType())) requests.push(r.url());
    });
    await open.click();

    await expect(
      page.getByRole('heading', { level: 1, name: messages.about, exact: true }),
    ).toBeFocused();
    await expect(screen(page, 'about').getByRole('heading', { level: 2 })).toHaveCount(3);
    expect(requests).toEqual([]);
    const items = screen(page, 'about').locator('[data-about="asset"]');
    await expect(items).toHaveCount(ABOUT_CREDITS.assets.length);
    for (const [index, credit] of ABOUT_CREDITS.assets.entries()) {
      const label = (key: keyof typeof en): string => messages[key];
      await expect(items.nth(index)).toHaveText(
        `${assetKindLabel(credit.kind, label)}: ${credit.asset}${credit.licence} · ${assetAuthors(credit, label)}`,
      );
    }
    if (messages !== en) {
      // Every English label must be gone from the German list; names and ids stay.
      const text = (await items.allInnerTexts()).join('\n');
      for (const key of Object.keys(en).filter((k) =>
        k.startsWith('credit'),
      ) as (keyof typeof en)[])
        expect(text).not.toMatch(new RegExp(`\\b${en[key]}\\b`));
    }

    for (const summary of await screen(page, 'about').locator('summary').all())
      await summary.click();
    await expect(screen(page, 'about').locator('details[open]')).toHaveCount(
      1 + ABOUT_CREDITS.thirdParty.length,
    );
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
    await expect(screen(page, 'about')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => history.state as unknown)).toBeNull();
    await context.close();
  });
}

test('About lists the app licence, every bundled licence and every asset source', async ({
  page,
}) => {
  await page.goto('./');
  await screen(page, 'title').getByRole('button', { name: en.about, exact: true }).click();
  const about = screen(page, 'about');
  await expect(about.getByRole('heading', { level: 2, name: en.aboutAssets })).toBeVisible();

  await expect(about.locator('[data-about="thirdParty"]')).toHaveCount(
    ABOUT_CREDITS.thirdParty.length,
  );
  await expect(about.locator('[data-about="asset"]')).toHaveCount(ABOUT_CREDITS.assets.length);
  await expect(about.locator('details')).toHaveCount(1 + ABOUT_CREDITS.thirdParty.length);
  for (const { name, spdx } of [ABOUT_CREDITS.app, ...ABOUT_CREDITS.thirdParty])
    await expect(about.locator('summary', { hasText: `${name} · ${spdx}` })).toBeVisible();

  const [first] = ABOUT_CREDITS.assets;
  if (first === undefined) throw new Error('the credits list no asset');
  const link = about.locator(`a[href="${first.page}"]`);
  await expect(link).toHaveText(`${en.creditKindKitTile}: ${first.asset}`);
  await expect(link).toHaveAttribute('rel', 'noopener');
  await expect(about.getByRole('link', { name: new RegExp(en.aboutSource) })).toHaveAttribute(
    'href',
    'https://github.com/DocGerd/gegenlenker',
  );

  const bundled = ABOUT_CREDITS.thirdParty.find((entry) => entry.bundled.length > 0);
  if (bundled === undefined) throw new Error('the credits list no bundled package');
  const incl = en.aboutIncludes.replace('{packages}', bundled.bundled.join(', '));
  await expect(about.getByText(`${bundled.covers.join(', ')} (${incl})`)).toBeVisible();

  await about.locator('summary').first().click();
  await expect(about.locator('pre').first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('the copyright line is on About, not on the title', async ({ page }) => {
  await page.goto('./');
  const title = screen(page, 'title');
  await expect(title.getByRole('button', { name: en.exercises, exact: true })).toBeVisible();
  await expect(title.getByText('Patrick Kuhn')).toHaveCount(0);

  await title.getByRole('button', { name: en.about, exact: true }).click();
  await expect(screen(page, 'about').getByText('© 2026 Patrick Kuhn')).toBeVisible();
});
