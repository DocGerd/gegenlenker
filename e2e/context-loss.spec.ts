import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';
import { bareScreenshot, distinctColours } from './pinned-shoot';

const SETTINGS_KEY = 'gegenlenker.settings.v1';

/** Loses the current canvas's context; resolves with a handle to that canvas. */
async function loseContext(page: Page) {
  const canvas = page.locator('.drive-surface > canvas');
  const handle = await canvas.evaluateHandle((c) => c);
  await canvas.evaluate((c) => {
    if (!(c instanceof HTMLCanvasElement)) throw new Error('no canvas');
    c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  return handle;
}

test('a lost GPU context comes back on a fresh canvas and the drive goes on', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [SETTINGS_KEY, JSON.stringify({ version: 1, graphics: 'high' })] as const,
  );
  await page.goto('./');
  await page.getByRole('button', { name: new RegExp(`^${en.exerciseStraightReverse}`) }).click();
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-render-backend', 'webgl2');
  await expect(html).toHaveAttribute('data-vehicle-pbr', 'on');
  await expect(html).toHaveAttribute('data-ground-texture', /^ktx2:/);

  const lost = await loseContext(page);
  await expect.poll(() => lost.evaluate((c) => c.isConnected)).toBe(false);
  await expect(page.locator('.drive-surface > canvas')).toHaveCount(1);
  await expect(page.getByText(en.contextLost)).toHaveCount(0);
  await expect(html).toHaveAttribute('data-vehicle-pbr', 'on');
  await expect(html).toHaveAttribute('data-ground-texture', /^ktx2:/);

  const pane = await page.locator('[data-hud="topDown"]').boundingBox();
  if (pane === null) throw new Error('no top-down pane');
  await expect
    .poll(async () => distinctColours(page, await bareScreenshot(page, pane)))
    .toBeGreaterThan(50);

  const speed = page.locator('[data-hud="speed"]');
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(speed).not.toHaveText('0.0 km/h');

  // Pan and zoom listen on the surface, which outlives the canvas.
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.mouse.wheel(0, -300);
  await expect(page.locator('[data-hud="resetView"]')).toBeEnabled();

  // Headless Chromium denies the wake lock; that warning is not about graphics.
  expect(problems.filter((p) => !p.includes('Wake Lock'))).toEqual([]);
});

test('losses in quick succession end at the reload notice', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: new RegExp(`^${en.exerciseStraightReverse}`) }).click();
  await expect(page.locator('html')).toHaveAttribute('data-render-backend', 'webgl2');
  for (let i = 0; i < 3; i++) {
    const lost = await loseContext(page);
    await expect.poll(() => lost.evaluate((c) => c.isConnected)).toBe(false);
  }
  await loseContext(page);
  await expect(page.getByText(en.contextLost)).toBeVisible();
});
