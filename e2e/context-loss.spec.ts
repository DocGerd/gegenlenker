import { createHash } from 'node:crypto';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { expectNoFailedAttachment, watchFailedAttachments } from './attachment-markers';
import { DRIVER_PERFORMANCE_HINT } from './three-problems';
import {
  bareScreenshot,
  HIGH_WAIT_MS,
  distinctColours,
  HEAVY,
  MIN_DRAWN_COLOURS,
  settle,
  shoot,
  startPinnedDrive,
  step,
  timeoutWithSettles,
} from './pinned-shoot';
import { exerciseEntry, startExercise } from './menu-flow';

const high = { timeout: HIGH_WAIT_MS };
/** Frames the sim runs under a pressed lever before the speed gauge is read. */
const SPEED_FRAMES = 30;
const LOST = 'Graphics context lost; starting afresh';

/**
 * Console warnings and errors, to assert the exact logs a loss produces; page errors and THREE
 * warnings fail through the guard fixture. Headless Chromium denies the wake lock, which is not
 * about graphics.
 */
function collectLogs(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    const text = m.text();
    if (
      (m.type() === 'error' || m.type() === 'warning') &&
      !text.includes('Wake Lock') &&
      !DRIVER_PERFORMANCE_HINT.test(text)
    ) {
      problems.push(text);
    }
  });
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
  await expect.poll(() => lost.evaluate((c) => c.isConnected), high).toBe(false);
}

async function startDrive(page: Page): Promise<void> {
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
}

test(
  'a lost GPU context comes back on a fresh canvas and the drive goes on',
  { tag: HEAVY },
  async ({ page }) => {
    test.setTimeout(timeoutWithSettles('high', 2, 180_000));
    const problems = collectLogs(page);
    await watchFailedAttachments(page);
    await startPinnedDrive(
      page,
      { preset: 'high', lighting: 'day' },
      exerciseEntry('straight-reverse'),
    );
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-vehicle-pbr', 'on');
    await expect(html).toHaveAttribute('data-ground-texture', /^ktx2:/);
    await expect(html).toHaveAttribute('data-ground-pbr', /^ktx2:/);
    // a loss during a load would warn and spend a retry
    await expect(html).toHaveAttribute('data-sky-hdri', 'on');
    await expect(html).toHaveAttribute('data-yard-kit', 'on');
    await page.evaluate(() => {
      const seen: (string | null)[] = [];
      Object.assign(window, { pbrSeen: seen });
      const root = document.documentElement;
      new MutationObserver((records) => {
        for (const r of records) seen.push(r.oldValue);
      }).observe(root, { attributeFilter: ['data-vehicle-pbr'], attributeOldValue: true });
    });

    await loseAndReplace(page);
    await expect(html).toHaveAttribute('data-render-backend', 'webgl2');
    await settle(page, 'high');
    await expect(page.locator('.drive-surface > canvas')).toHaveCount(1);
    await expect(page.getByText(en.contextLost)).toHaveCount(0);
    await expect(html).toHaveAttribute('data-yard-kit', 'on');
    // The reflections were rebuilt for the new renderer, not left over from the old one.
    expect(
      await page.evaluate(() => {
        // A null old value: the attribute was set again after it had been removed.
        const seen = (window as unknown as { pbrSeen: (string | null)[] }).pbrSeen;
        return seen.includes(null) && document.documentElement.dataset['vehiclePbr'] === 'on';
      }),
    ).toBe(true);

    const pane = await page.locator('[data-hud="topDown"]').boundingBox();
    if (pane === null) throw new Error('no top-down pane');
    expect(
      await distinctColours(page, await bareScreenshot(page, pane, () => step(page, 1))),
    ).toBeGreaterThan(MIN_DRAWN_COLOURS);

    const speed = page.locator('[data-hud="speed"]');
    await page.keyboard.press('4');
    for (let i = 0; i < 5; i++) await page.keyboard.press('w');
    await step(page, SPEED_FRAMES);
    await expect(speed).not.toHaveText('0.0 km/h');

    // Pan and zoom listen on the surface, which outlives the canvas.
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
    await page.mouse.wheel(0, -300);
    await step(page, 1);
    await expect(page.locator('[data-hud="resetView"]')).toBeEnabled();

    expect(problems).toEqual([LOST]);
    await expectNoFailedAttachment(page);
  },
);

test('the cockpit looks the same after a loss as before it', { tag: HEAVY }, async ({ page }) => {
  test.setTimeout(timeoutWithSettles('high', 2, 180_000));
  const problems = collectLogs(page);
  await watchFailedAttachments(page);
  await startPinnedDrive(
    page,
    { preset: 'high', lighting: 'day' },
    exerciseEntry('straight-reverse'),
  );
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
  await expectNoFailedAttachment(page);
});

test('losses in quick succession end at the reload notice', async ({ page, allow }) => {
  allow(/Graphics could not start/);
  const problems = collectLogs(page);
  await startDrive(page);
  for (let i = 0; i < 3; i++) await loseAndReplace(page);
  await loseLiveContext(page);
  await expect(page.getByText(en.contextLost)).toBeVisible();
  expect(problems.slice(0, 4)).toEqual([LOST, LOST, LOST, LOST]);
  expect(problems.slice(4)).toEqual([expect.stringContaining('Graphics could not start')]);
});
