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
  const locked = (): Promise<boolean> =>
    page.evaluate(() => document.pointerLockElement?.classList.contains('drive-surface') === true);

  await surface(page).click({ position: { x: 300, y: 200 } });
  await expect.poll(locked).toBe(true);
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
  await expect.poll(locked).toBe(false);
  // resuming takes a click: the lock is not asked for again by itself
  await sheet(page).getByRole('button', { name: en.continue }).click();
  await expect(sheet(page)).toBeHidden();
  expect(await locked()).toBe(false);
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

test('the Einweiser toggles the driver sight areas, stored and drawn without a render error', async ({
  page,
}) => {
  await startEinweiser(page);
  const chip = (flag: string) => page.locator(`[data-sight="${flag}"]`);
  await expect(chip('top')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip('ground')).toHaveAttribute('aria-pressed', 'false');

  await chip('top').click();
  await chip('ground').click();
  await expect(chip('top')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('ground')).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toMatchObject({ sight: { top: true, ground: true } });
  // frames with both drawn; the fixtures fail the test on a shader or render error
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 0;
        const tick = (): void => {
          if (++frames > 10) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

  await chip('top').click();
  await expect(chip('top')).toHaveAttribute('aria-pressed', 'false');
  expect(await stored(page)).toMatchObject({ sight: { top: false, ground: true } });
});
