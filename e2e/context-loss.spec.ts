import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';
import {
  bareScreenshot,
  distinctColours,
  MIN_DRAWN_COLOURS,
  SCREENSHOT_POLL,
  settle,
  shoot,
  startPinnedDrive,
} from './pinned-shoot';

const SETTINGS_KEY = 'gegenlenker.settings.v1';
const LOST = 'Graphics context lost; starting afresh';

/** Console warnings, errors and page errors; headless Chromium denies the wake lock, which is not about graphics. */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('Wake Lock')) {
      problems.push(m.text());
    }
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

/** Waits for a live renderer and loses its canvas's context; resolves with a handle to that canvas. */
async function loseLiveContext(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-render-backend', 'webgl2');
  const canvas = page.locator('.drive-surface > canvas');
  const lost = await canvas.evaluateHandle((c) => c);
  await canvas.evaluate((c) => {
    if (!(c instanceof HTMLCanvasElement)) throw new Error('no canvas');
    c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  return lost;
}

/** Loses the live context and waits until a fresh canvas replaced the lost one. */
async function loseAndReplace(page: Page): Promise<void> {
  const lost = await loseLiveContext(page);
  await expect.poll(() => lost.evaluate((c) => c.isConnected)).toBe(false);
}

async function startDrive(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: new RegExp(`^${en.exerciseStraightReverse}`) }).click();
}

test('a lost GPU context comes back on a fresh canvas and the drive goes on', async ({ page }) => {
  const problems = collectProblems(page);
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [SETTINGS_KEY, JSON.stringify({ version: 1, graphics: 'high' })] as const,
  );
  await startDrive(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-vehicle-pbr', 'on');
  await expect(html).toHaveAttribute('data-ground-texture', /^ktx2:/);
  await page.evaluate(() => {
    const seen: (string | null)[] = [];
    Object.assign(window, { pbrSeen: seen });
    const root = document.documentElement;
    new MutationObserver((records) => {
      for (const r of records) seen.push(r.oldValue);
    }).observe(root, { attributeFilter: ['data-vehicle-pbr'], attributeOldValue: true });
  });

  await loseAndReplace(page);
  await expect(page.locator('.drive-surface > canvas')).toHaveCount(1);
  await expect(html).toHaveAttribute('data-render-backend', 'webgl2');
  await expect(page.getByText(en.contextLost)).toHaveCount(0);
  // The reflections were rebuilt for the new renderer, not left over from the old one.
  await expect
    .poll(() =>
      page.evaluate(() => {
        // A null old value: the attribute was set again after it had been removed.
        const seen = (window as unknown as { pbrSeen: (string | null)[] }).pbrSeen;
        return seen.includes(null) && document.documentElement.dataset['vehiclePbr'] === 'on';
      }),
    )
    .toBe(true);

  const pane = await page.locator('[data-hud="topDown"]').boundingBox();
  if (pane === null) throw new Error('no top-down pane');
  await expect
    .poll(async () => distinctColours(page, await bareScreenshot(page, pane)), SCREENSHOT_POLL)
    .toBeGreaterThan(MIN_DRAWN_COLOURS);

  const speed = page.locator('[data-hud="speed"]');
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(speed).not.toHaveText('0.0 km/h');

  // Pan and zoom listen on the surface, which outlives the canvas.
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.mouse.wheel(0, -300);
  await expect(page.locator('[data-hud="resetView"]')).toBeEnabled();

  expect(problems).toEqual([LOST]);
});

test('the cockpit looks the same after a loss as before it', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await startPinnedDrive(page, 'high', en.exerciseStraightReverse);
  const hash = async (): Promise<string> => {
    const png = await shoot(page, 'cockpit');
    expect(await distinctColours(page, png)).toBeGreaterThan(MIN_DRAWN_COLOURS);
    return createHash('sha256').update(png).digest('hex');
  };
  const before = await hash();
  await loseAndReplace(page);
  await expect(page.locator('html')).toHaveAttribute('data-render-backend', 'webgl2');
  await settle(page, 'high');
  expect(await hash()).toBe(before);
  expect(problems).toEqual([LOST]);
});

test('losses in quick succession end at the reload notice', async ({ page }) => {
  const problems = collectProblems(page);
  await startDrive(page);
  for (let i = 0; i < 3; i++) await loseAndReplace(page);
  await loseLiveContext(page);
  await expect(page.getByText(en.contextLost)).toBeVisible();
  expect(problems.slice(0, 4)).toEqual([LOST, LOST, LOST, LOST]);
  expect(problems.slice(4)).toEqual([expect.stringContaining('Graphics could not start')]);
});
