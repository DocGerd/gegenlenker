import { expect, test, type Locator, type Page } from '@playwright/test';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';

const sizes = [
  { width: 768, height: 1024 },
  { width: 800, height: 820 },
  { width: 1024, height: 600 },
  { width: 1024, height: 700 },
  { width: 1280, height: 649 },
  { width: 1280, height: 720 },
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
        expect(overlaps(m, c), `${c.name} overlaps a mirror`).toBe(false);
      }
    }

    const panels = await boxes(
      page.locator('.hud-goal:not([hidden]), .hud-gauge, .hud-counters, .hud-action'),
    );
    for (const panel of panels) {
      for (const c of controlBoxes) {
        expect(overlaps(panel, c), `${panel.name} overlaps ${c.name}`).toBe(false);
      }
    }
  });

  test(`the cockpit view has no blank band at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('./');
    await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
    await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(2);
    await page.waitForTimeout(500);
    expect(await blankRows(page, Math.round(size.width * 0.3))).toBe(0);
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
