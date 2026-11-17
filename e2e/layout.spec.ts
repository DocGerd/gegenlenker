import { expect, test, type Locator } from '@playwright/test';
import { en } from '../src/i18n/en';

const sizes = [
  { width: 768, height: 1024 },
  { width: 800, height: 820 },
  { width: 1280, height: 800 },
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
      '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-stop, .ctl-lever',
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
