import { expect, test, type Locator } from '@playwright/test';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';

const sizes = [
  { width: 768, height: 1024 },
  { width: 800, height: 820 },
  { width: 1024, height: 600 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
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

for (const size of sizes) {
  test(`mirrors clear the controls at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('./');
    await page.getByRole('button', { name: en.exerciseStraightReverse }).click();

    const mirrors = page.locator('.hud-mirror:not([hidden])');
    await expect(mirrors).toHaveCount(2);
    const controls = page.locator(
      '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-stop, .ctl-lever, .hud-legend',
    );

    const mirrorBoxes = await boxes(mirrors);
    const controlBoxes = await boxes(controls);
    expect(controlBoxes.length).toBeGreaterThan(0);

    for (const m of mirrorBoxes) {
      for (const c of controlBoxes) {
        const intersects =
          m.left < c.right && c.left < m.right && m.top < c.bottom && c.top < m.bottom;
        expect(intersects, `${c.name} overlaps a mirror`).toBe(false);
      }
    }
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
