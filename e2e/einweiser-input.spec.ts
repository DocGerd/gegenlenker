import type { Page } from '@playwright/test';
import type { SignId } from '../src/contracts/einweiser';
import { en } from '../src/i18n/en';
import { expect, test } from './fixtures';
import { startEntry, yardEntry } from './menu-flow';
import { seedStorage } from './menu-seed';
import { SETTINGS_KEY } from './pinned-shoot';

// The default headless shell doubles the frame interval on every frame while the pointer is locked,
// even on a bare page, so the pointer-lock test timed out; the new headless mode keeps the frame rate.
test.use({ channel: 'chromium' });

const einweiser = { ...yardEntry('depot'), role: 'einweiser' } as const;
const sheet = (page: Page) => page.getByRole('dialog', { name: en.paused });
const surface = (page: Page) => page.locator('.drive-surface');
const locked = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.pointerLockElement?.classList.contains('drive-surface') === true);
/** A click in the middle of his own view, above the band. */
async function clickView(page: Page): Promise<void> {
  const view = await page.locator('.hud-cockpit').boundingBox();
  if (view === null) throw new Error('no view');
  await page.mouse.click(view.x + view.width / 2, view.y + view.height / 3);
}

type Shown = { sign: SignId | null; pose: { x: number; y: number; heading: number } };
const shown = (page: Page): Promise<Shown> =>
  page.evaluate(() => {
    const raw = document.querySelector<HTMLElement>('.drive')?.dataset['einweiser'];
    return JSON.parse(raw ?? 'null') as Shown;
  });
const stored = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>,
    SETTINGS_KEY,
  );

async function startEinweiser(page: Page): Promise<void> {
  await seedStorage(page, { settings: { graphics: 'low' } });
  await page.goto('./?framing=1');
  await startEntry(page, en, einweiser);
  await expect(page.locator('.drive[data-role="einweiser"]')).toBeAttached();
  await expect.poll(() => shown(page)).not.toBeNull();
}

test('the Einweiser walks and signs on the keys and has no driver controls', async ({ page }) => {
  await startEinweiser(page);
  await expect(page.locator('.ctl')).toHaveCount(0);

  const keys = page.locator('[data-hud="keys"]');
  await expect(keys).toContainText(en.walk);
  await expect(keys).toContainText(en.signKeys);
  await expect(keys).not.toContainText(en.keyWheel);
  await expect(keys).not.toContainText(en.stop);

  expect((await shown(page)).sign).toBeNull();
  await page.keyboard.down('Digit5');
  await expect.poll(async () => (await shown(page)).sign).toBe('herkommen');
  // the last pressed key shows, and Q is Links fahren, not a glance
  await page.keyboard.down('KeyQ');
  await expect.poll(async () => (await shown(page)).sign).toBe('links');
  await page.keyboard.up('KeyQ');
  await expect.poll(async () => (await shown(page)).sign).toBe('herkommen');
  await page.keyboard.up('Digit5');
  await expect.poll(async () => (await shown(page)).sign).toBeNull();

  const before = (await shown(page)).pose;
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => {
      const { x, y } = (await shown(page)).pose;
      return Math.hypot(x - before.x, y - before.y);
    })
    .toBeGreaterThan(0.3);
  await page.keyboard.up('KeyW');
});

test('a click takes the pointer lock, mouse buttons sign under it, and losing it opens the pause sheet', async ({
  page,
}) => {
  await startEinweiser(page);

  await surface(page).click({ position: { x: 300, y: 200 } });
  await expect.poll(() => locked(page)).toBe(true);
  // the click that took the lock shows no sign
  expect((await shown(page)).sign).toBeNull();

  await page.mouse.down();
  await expect.poll(async () => (await shown(page)).sign).toBe('herkommen');
  await page.mouse.up();
  await page.mouse.down({ button: 'right' });
  await expect.poll(async () => (await shown(page)).sign).toBe('entfernen');
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => (await shown(page)).sign).toBeNull();

  await page.evaluate(() => {
    document.exitPointerLock();
  });
  await expect(sheet(page)).toBeVisible();
  await expect.poll(() => locked(page)).toBe(false);
  // resuming takes a click: the lock is not asked for again by itself
  await sheet(page).getByRole('button', { name: en.continue }).click();
  await expect(sheet(page)).toBeHidden();
  expect(await locked(page)).toBe(false);
});

test('the pause sheet lists the look settings for the Einweiser only, and they apply at once', async ({
  page,
}) => {
  await startEinweiser(page);
  await page.keyboard.press('Escape');
  await sheet(page).getByRole('button', { name: en.settings }).click();
  const group = (name: string) => sheet(page).getByRole('radiogroup', { name, exact: true });
  await expect(group(en.wideMirrors)).toHaveCount(0);
  await group(en.fov).getByText('70°', { exact: true }).click();
  await group(en.mouseSensitivity).getByText(en.sensitivityHigh, { exact: true }).click();
  await group(en.invertMouse).getByText(en.settingOn, { exact: true }).click();
  expect(await stored(page)).toMatchObject({
    fov: 70,
    mouseSensitivity: 'high',
    invertMouse: true,
  });
});

test('the Settings screen lists the Einweiser options on a desktop', async ({ page }) => {
  await seedStorage(page, { settings: { graphics: 'low' } });
  await page.goto('./');
  await page.getByRole('button', { name: en.settings }).click();
  await expect(page.getByRole('heading', { name: en.settingsEinweiser })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: en.fov, exact: true })).toBeVisible();
});

test('the Einweiser toggles the driver sight areas on the chips, his key and the pause sheet, stored and drawn without a render error', async ({
  page,
}) => {
  await startEinweiser(page);
  const chip = (flag: string) => page.locator(`[data-sight="${flag}"]`);
  const group = (name: string) => sheet(page).getByRole('radiogroup', { name, exact: true });
  const drive = page.locator('.drive');
  /** Frames on until both are sampled and drawn; the fixtures fail the test on a shader or render error. */
  const sampled = async (): Promise<void> => {
    const from = Number(await drive.getAttribute('data-drawn'));
    await expect
      .poll(async () => Number(await drive.getAttribute('data-drawn')))
      .toBeGreaterThan(from + 1);
    await expect(drive).toHaveAttribute('data-sight-pending', 'false');
  };
  await expect(chip('top')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip('ground')).toHaveAttribute('aria-pressed', 'false');

  await chip('top').click();
  await chip('ground').click();
  await expect(chip('top')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('ground')).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toMatchObject({ sight: { top: true, ground: true } });
  await sampled();

  await page.keyboard.press('KeyG');
  await expect(chip('ground')).toHaveAttribute('aria-pressed', 'false');
  expect(await stored(page)).toMatchObject({ sight: { top: true, ground: false } });

  // after his look settings; the own view's row names the key
  await page.keyboard.press('Escape');
  await sheet(page).getByRole('button', { name: en.settings }).click();
  expect(
    await sheet(page)
      .getByRole('radiogroup')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-menu'))),
  ).toEqual([
    'fov',
    'mouseSensitivity',
    'invertMouse',
    'sightTop',
    'sightGround',
    'theme',
    'graphics',
  ]);
  await expect(group(en.aidSightGround)).toHaveAccessibleDescription(en.groundSightKeyHint);
  // both off for one drawn frame drops the old sample, so the next toggle samples anew
  const drawnAfter = async (from: number): Promise<void> => {
    await expect
      .poll(async () => Number(await drive.getAttribute('data-drawn')))
      .toBeGreaterThan(from);
  };
  const first = Number(await drive.getAttribute('data-drawn'));
  await group(en.aidSightTop).getByText(en.settingOff, { exact: true }).click();
  await group(en.aidSightGround).getByText(en.settingOff, { exact: true }).click();
  await drawnAfter(first);
  const before = Number(await drive.getAttribute('data-drawn'));
  await group(en.aidSightGround).getByText(en.settingOn, { exact: true }).click();
  // paused behind the sheet, the drive keeps drawing until the new sample is done; the marker is
  // written on drawn frames only, so wait for one before reading it
  await drawnAfter(before);
  await expect(drive).toHaveAttribute('data-sight-pending', 'false');
  expect(await stored(page)).toMatchObject({ sight: { top: false, ground: true } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect(chip('top')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip('ground')).toHaveAttribute('aria-pressed', 'true');

  // without the top view: only his own view's row, and the stored top-view flag is kept
  await page.evaluate((key) => {
    const settings = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(
      key,
      JSON.stringify({ ...settings, mirrorsOnly: true, sight: { top: true, ground: true } }),
    );
  }, SETTINGS_KEY);
  await startEinweiser(page);
  await sampled();
  await page.keyboard.press('Escape');
  await sheet(page).getByRole('button', { name: en.settings }).click();
  await expect(group(en.aidSightTop)).toHaveCount(0);
  await group(en.aidSightGround).getByText(en.settingOff, { exact: true }).click();
  expect(await stored(page)).toMatchObject({ sight: { top: true, ground: false } });
});

test('a click in the top view pans it and leaves the mouse free, a click in his view takes the lock', async ({
  page,
}) => {
  await startEinweiser(page);
  const reset = page.locator('[data-hud="resetView"]');
  const hint = page.locator('[data-hud="lockHint"]');
  await expect(reset).toBeDisabled();

  const pane = await page.locator('.hud-topdown').boundingBox();
  if (pane === null) throw new Error('no top-down pane');
  const x = pane.x + pane.width / 2;
  const y = pane.y + pane.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 30, { steps: 5 });
  await page.mouse.up();
  await expect(reset).toBeEnabled();
  expect(await locked(page)).toBe(false);
  await expect(hint).toBeHidden();

  await clickView(page);
  await expect.poll(() => locked(page)).toBe(true);
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText(en.lockHint);
});

test('P releases the mouse like Esc: the hint goes and the pause sheet opens', async ({ page }) => {
  await startEinweiser(page);
  await clickView(page);
  await expect.poll(() => locked(page)).toBe(true);
  await expect(page.locator('[data-hud="lockHint"]')).toBeVisible();

  await page.keyboard.press('KeyP');
  await expect(sheet(page)).toBeVisible();
  await expect.poll(() => locked(page)).toBe(false);
  await expect(page.locator('[data-hud="lockHint"]')).toBeHidden();
});
