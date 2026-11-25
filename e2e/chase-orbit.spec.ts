import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import {
  bareScreenshot,
  distinctColours,
  heavyAt,
  MIN_DRAWN_COLOURS,
  PRESET_TIMEOUT_MS,
  shoot,
  startPinnedDrive,
  timeoutWithSettles,
} from './pinned-shoot';
import { collectThreeProblems } from './three-problems';

const hash = (png: Buffer): string => createHash('sha256').update(png).digest('hex');
/** Sim milliseconds that draw the frames a view change needs. */
const REDRAW_MS = 500;
/** `,` or `.` presses that turn the camera half way round: 5 degrees each. */
const HALF_TURN_PRESSES = 36;

async function pane(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('[data-hud="topDown"]').boundingBox();
  if (box === null) throw new Error('no top-down pane');
  return box;
}

/** The chase pane as it is now, after the frames a change needs. */
async function chaseShot(page: Page): Promise<Buffer> {
  return bareScreenshot(page, await pane(page), () => page.clock.runFor(REDRAW_MS));
}

async function press(page: Page, key: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

test(
  'the chase view orbits, tilts and zooms from the keys, the mouse and the wheel, and every reset restores the default',
  heavyAt('balanced'),
  async ({ page }) => {
    test.setTimeout(timeoutWithSettles('balanced', 1, PRESET_TIMEOUT_MS.balanced));
    const three = collectThreeProblems(page);
    await startPinnedDrive(
      page,
      { preset: 'balanced', lighting: 'day' },
      en.exerciseStraightReverse,
    );
    const first = await shoot(page, 'chase');
    expect(await distinctColours(page, first), 'default view').toBeGreaterThan(MIN_DRAWN_COLOURS);
    const resetButton = page.locator('[data-hud="resetView"]');
    await expect(resetButton).toBeDisabled();
    const seen = new Set([hash(first)]);
    const shot = async (what: string): Promise<void> => {
      const png = await chaseShot(page);
      expect(await distinctColours(page, png), what).toBeGreaterThan(MIN_DRAWN_COLOURS);
      const key = hash(png);
      expect(seen.has(key), `${what} differs from every earlier view`).toBe(false);
      seen.add(key);
    };

    // the wheel alone, from the default view
    const start = await pane(page);
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.wheel(0, -400);
    await shot('wheeled in from the default');
    await page.keyboard.press('0');
    expect(hash(await chaseShot(page)), 'reset after the wheel').toBe(hash(first));

    // behind the combination, from the keys
    await press(page, '.', HALF_TURN_PRESSES);
    await expect(resetButton).toBeEnabled();
    await shot('orbited behind');
    // from above, then from the lowest pitch
    await press(page, 'PageUp', 14);
    await shot('tilted up');
    await press(page, 'PageDown', 30);
    await shot('tilted down');

    // drag, then wheel
    const box = await pane(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y - 40, { steps: 6 });
    await page.mouse.up();
    await shot('dragged');
    await page.mouse.wheel(0, -400);
    await shot('wheeled in');

    // the reset key, the button and a view switch each bring the default back
    await page.keyboard.press('0');
    expect(hash(await chaseShot(page)), 'reset key').toBe(hash(first));
    await expect(resetButton).toBeDisabled();

    await press(page, ',', 7);
    await page.mouse.wheel(0, 300);
    await shot('orbited and zoomed out');
    await resetButton.click();
    expect(hash(await chaseShot(page)), 'reset button').toBe(hash(first));

    await press(page, ',', 7);
    await page.keyboard.press('f');
    await expect(page.locator('[data-view="follow"]')).toHaveAttribute('aria-pressed', 'true');
    expect(hash(await shoot(page, 'chase')), 'back from follow').toBe(hash(first));

    // the free camera starts exactly where the orbit was, turns while a key is held, and leaves with the reset
    const freeButton = page.locator('[data-hud="freeCamera"]');
    await page.keyboard.press('k');
    await expect(freeButton).toHaveAttribute('aria-pressed', 'true');
    expect(hash(await chaseShot(page)), 'free camera entry').toBe(hash(first));
    await page.keyboard.down('Period');
    const flown = await chaseShot(page);
    await page.keyboard.up('Period');
    expect(await distinctColours(page, flown), 'turned').toBeGreaterThan(MIN_DRAWN_COLOURS);
    expect(hash(flown), 'turned differs from the orbit').not.toBe(hash(first));
    await page.keyboard.press('0');
    await expect(freeButton).toHaveAttribute('aria-pressed', 'false');
    expect(hash(await chaseShot(page)), 'reset leaves the free camera').toBe(hash(first));
    expect(three).toEqual([]);
  },
);
