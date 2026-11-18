import { expect, test, type Locator, type Page } from '@playwright/test';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';

const sizes = [
  { width: 768, height: 700 },
  { width: 768, height: 1024 },
  { width: 800, height: 820 },
  { width: 900, height: 649 },
  { width: 1000, height: 649 },
  { width: 1024, height: 600 },
  { width: 1024, height: 700 },
  { width: 1200, height: 700 },
  { width: 1210, height: 720 },
  { width: 1280, height: 649 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1300, height: 540 },
  { width: 1300, height: 600 },
  { width: 1366, height: 768 },
];

/** The key legend wraps differently per language, so every size runs in both. */
const locales = [
  { locale: 'en-US', messages: en },
  { locale: 'de-DE', messages: de },
];

const boxes = (loc: Locator) =>
  loc.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        name: el.getAttribute('class') ?? '',
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      };
    }),
  );

const overlaps = (
  a: Awaited<ReturnType<typeof boxes>>[number],
  b: Awaited<ReturnType<typeof boxes>>[number],
) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Rows at the top of a full-viewport screenshot column that show the bare page background. */
async function blankRows(page: Page, x: number): Promise<number> {
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ([data, column]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const background = getComputedStyle(document.body).backgroundColor;
      let y = 0;
      for (; y < img.height; y++) {
        const [r = 0, g = 0, b = 0] = ctx.getImageData(column, y, 1, 1).data;
        if (`rgb(${r}, ${g}, ${b})` !== background) break;
      }
      return y;
    },
    [shot, x] as const,
  );
}

/** Waits until the HUD, gauges and controls are laid out, so measuring never sees an empty set. */
async function hudReady(page: Page): Promise<void> {
  await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(2);
  const gauges = page.locator('.hud-gauge');
  await expect(gauges).toHaveCount(2);
  await expect(gauges.first()).toBeVisible();
  await expect(gauges.last()).toBeVisible();
  await expect(page.locator('.hud-counters')).toBeVisible();
  await expect(page.locator('.hud-action')).toBeVisible();
  await expect(page.locator('.ctl-wheel')).toBeVisible();
  await expect(page.locator('.ctl-lever')).toBeVisible();
}

for (const { locale, messages } of locales) {
  for (const size of sizes) {
    const at = `${locale} ${size.width}x${size.height}`;

    test(`mirrors clear the controls at ${at}`, async ({ browser }) => {
      const context = await browser.newContext({ locale, viewport: size });
      const page = await context.newPage();
      await page.goto('./');
      await page.getByRole('button', { name: messages.exerciseStraightReverse }).click();

      await hudReady(page);
      const mirrors = page.locator('.hud-mirror:not([hidden])');
      const controls = page.locator(
        '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-stop, .ctl-lever, .hud-legend',
      );

      const mirrorBoxes = await boxes(mirrors);
      const controlBoxes = await boxes(controls);
      expect(controlBoxes.length).toBeGreaterThan(0);

      for (const m of mirrorBoxes) {
        for (const c of controlBoxes) {
          expect(overlaps(m, c), `${c.name} overlaps a mirror`).toBe(false);
        }
      }

      const panels = await boxes(
        page.locator('.hud-goal:not([hidden]), .hud-gauge, .hud-counters, .hud-action'),
      );
      expect(panels.length).toBeGreaterThan(0);
      for (const panel of panels) {
        for (const c of controlBoxes) {
          expect(overlaps(panel, c), `${panel.name} overlaps ${c.name}`).toBe(false);
        }
      }

      const clipped = await page
        .locator('.hud-gauge .hud-label')
        .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length);
      expect(clipped, 'a gauge label is wider than its gauge').toBe(0);
      await context.close();
    });

    test(`the cockpit view has no blank band at ${at}`, async ({ browser }) => {
      const context = await browser.newContext({ locale, viewport: size });
      const page = await context.newPage();
      await page.goto('./');
      await page.getByRole('button', { name: messages.exerciseStraightReverse }).click();
      await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(2);
      await page.waitForTimeout(500);
      expect(await blankRows(page, Math.round(size.width * 0.3))).toBe(0);
      await context.close();
    });
  }
}

const insets = { top: 24, left: 48, bottom: 20, right: 48 };

const insetSizes = [
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
  { width: 900, height: 649 },
  { width: 768, height: 1024 },
];

for (const size of insetSizes) {
  test(`the drive screen stays inside the safe area at ${size.width}x${size.height}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'en-US', viewport: size });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await page.goto('./');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--safe-left'),
        ),
      )
      .toBe(`${insets.left}px`);
    await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
    await hudReady(page);

    const placed = await boxes(
      page.locator(
        [
          '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-stop, .ctl-lever',
          '.hud-action, .hud-goal:not([hidden]), .hud-gauge, .hud-counters, .hud-legend',
          '.hud-gear, .hud-speed, .hud-cockpit > .hud-view-label, .hud-mirror:not([hidden])',
        ].join(', '),
      ),
    );
    expect(placed.length).toBeGreaterThan(0);
    for (const b of placed) {
      const at = `${b.name} in the safe area`;
      expect(b.left, at).toBeGreaterThanOrEqual(insets.left);
      expect(b.right, at).toBeLessThanOrEqual(size.width - insets.right);
      expect(b.bottom, at).toBeLessThanOrEqual(size.height - insets.bottom);
    }
    const topEdge = await boxes(
      page.locator('.hud-action, .hud-goal:not([hidden]), .hud-cockpit > .hud-view-label'),
    );
    const landscape = size.width >= size.height;
    for (const b of topEdge) {
      // In portrait the cockpit label sits mid-screen, so only the top view's panels reach the top edge.
      if (landscape || !b.name.includes('view-label')) {
        expect(b.top, `${b.name} below the top inset`).toBeGreaterThanOrEqual(insets.top);
      }
    }

    const mirrors = await boxes(page.locator('.hud-mirror:not([hidden])'));
    const controls = await boxes(
      page.locator(
        '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-stop, .ctl-lever, .hud-legend',
      ),
    );
    for (const m of mirrors) {
      for (const c of controls) {
        expect(overlaps(m, c), `${c.name} overlaps a mirror`).toBe(false);
      }
    }
    await context.close();
  });
}

const starts = [
  { name: 'exercise', label: en.exerciseStraightReverse },
  { name: 'yard', label: en.layoutDepot },
];

for (const start of starts) {
  test(`the ${start.name} top view stays compact at 1366x768`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('./');
    await page.getByRole('button', { name: start.label }).click();

    const buttons = page.locator('.hud-toolbar button');
    await expect(buttons.first()).toBeVisible();
    const rows = new Set((await boxes(buttons)).map((b) => Math.round(b.top)));
    expect(rows.size).toBeLessThanOrEqual(2);

    await expect(page.locator('.hud-info')).toBeVisible();
    const [info] = await boxes(page.locator('.hud-info'));
    expect(info?.bottom).toBeLessThan(768 / 2);
  });
}

test('the two gauges stay equally wide in German', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'de-DE',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  await page.goto('./');
  await page.getByRole('button', { name: de.exerciseStraightReverse }).click();

  await hudReady(page);
  const widths = (await boxes(page.locator('.hud-gauge'))).map((b) => b.right - b.left);
  expect(widths).toHaveLength(2);
  expect(widths[0]).toBeCloseTo(widths[1] ?? 0, 0);
  await context.close();
});

test('the key legend folds away and stays folded in the next run', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  const toggle = page.locator('[data-hud="keysToggle"]');
  await expect(page.locator('.hud-legend dl')).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.hud-legend dl')).toBeHidden();

  await page.reload();
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('.hud-legend dl')).toBeHidden();
  await expect(toggle).toBeVisible();
});
