import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';

const SETTINGS_KEY = 'gegenlenker.settings.v1';

/** Linear-to-sRGB output of an unlit vertex colour is the hue itself: `headliner` and `chevronBlack` (src/render/realism-hues.ts). */
const HEADLINER = [0x6f, 0x71, 0x6a] as const;
const DASH = [0x10, 0x12, 0x14] as const;
const TOLERANCE = 3;

async function drive(page: Page, graphics: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [SETTINGS_KEY, JSON.stringify({ version: 1, graphics })] as const,
  );
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(2);
  await expect(page.locator('.ctl-wheel')).toBeVisible();
  return errors;
}

/** The sRGB pixels of the bare cockpit canvas (HUD and controls hidden) at the given offsets from the cockpit's top-left. */
async function cockpitPixels(page: Page, at: readonly (readonly [number, number])[]) {
  const cockpit = await page.locator('.hud-cockpit').boundingBox();
  if (cockpit === null) throw new Error('no cockpit');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'bare-canvas';
    style.textContent = '.hud, .ctl, [class^="ctl-"] { visibility: hidden !important }';
    document.head.append(style);
  });
  const shot = (await page.screenshot({ clip: cockpit })).toString('base64');
  await page.evaluate(() => {
    document.getElementById('bare-canvas')?.remove();
  });
  return page.evaluate(
    async ([data, points]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)));
    },
    [shot, at] as const,
  );
}

const near = (pixel: number[] | undefined, want: readonly number[]): boolean =>
  pixel !== undefined && want.every((c, i) => Math.abs((pixel[i] ?? 0) - c) <= TOLERANCE);

for (const graphics of ['balanced', 'high'] as const) {
  test(`the ${graphics} cockpit view is framed by the dashboard and the roof header`, async ({
    page,
  }) => {
    const errors = await drive(page, graphics);
    await expect(page.locator('.hud[data-interior]')).toHaveCount(1);
    const cockpit = await page.locator('.hud-cockpit').boundingBox();
    if (cockpit === null) throw new Error('no cockpit');
    const x = Math.round(cockpit.width * 0.55);
    await expect
      .poll(async () => {
        const [top, bottom] = await cockpitPixels(page, [
          [x, 3],
          [x, Math.round(cockpit.height) - 4],
        ]);
        return [near(top, HEADLINER), near(bottom, DASH)];
      })
      .toEqual([true, true]);
    expect(errors).toEqual([]);
  });
}

test('the Low cockpit view has neither interior nor mirror housings', async ({ page }) => {
  const errors = await drive(page, 'low');
  await expect(page.locator('.hud[data-interior]')).toHaveCount(0);
  const cockpit = await page.locator('.hud-cockpit').boundingBox();
  if (cockpit === null) throw new Error('no cockpit');
  const x = Math.round(cockpit.width * 0.55);
  const [top, bottom] = await cockpitPixels(page, [
    [x, 3],
    [x, Math.round(cockpit.height) - 4],
  ]);
  expect(near(top, HEADLINER)).toBe(false);
  expect(near(bottom, DASH)).toBe(false);
  expect(errors).toEqual([]);
});
