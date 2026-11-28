import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { NBSP } from '../src/input/control-text';
import { exerciseEntry, openSetup, startControl, startExercise } from './menu-flow';

const stop = (page: Page) => page.locator('[data-ctl="stop"]');
const gear = (page: Page, g: string) => page.locator(`.ctl-gear[data-gear="${g}"]`);

async function startDrive(page: Page): Promise<void> {
  await page.goto('./');
  await startExercise(page, en, 'straight-reverse');
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
}

test('Enter on a focused gear selects it', async ({ page }) => {
  await startDrive(page);
  await expect(gear(page, 'P')).toHaveAttribute('aria-pressed', 'true');
  await gear(page, 'D').focus();
  await page.keyboard.press('Enter');
  await expect(gear(page, 'D')).toHaveAttribute('aria-pressed', 'true');
  await expect(gear(page, 'P')).toHaveAttribute('aria-pressed', 'false');
});

test('Enter on a focused Stop brakes while held', async ({ page }) => {
  await startDrive(page);
  await stop(page).focus();
  await page.keyboard.down('Enter');
  await expect(stop(page)).toHaveAttribute('data-active', '');
  await page.keyboard.up('Enter');
  await expect(stop(page)).not.toHaveAttribute('data-active');
});

test('the drive exposes no unnamed image', async ({ page }) => {
  await startDrive(page);
  const snapshot = await page.locator('body').ariaSnapshot();
  expect(snapshot).not.toMatch(/^\s*- img(?!\s+"[^"]+")/m);
});

test('the wheel and the lever expose their values and stay off the tab order', async ({ page }) => {
  await startDrive(page);
  const wheel = page.getByRole('meter', { name: en.steer });
  const lever = page.getByRole('meter', { name: en.speed });
  await expect(wheel).toHaveAttribute('aria-valuetext', en.steerValueStraight);
  await expect(lever).toHaveAttribute('aria-valuetext', `0${NBSP}%`);
  expect(await page.locator('body').ariaSnapshot()).toMatch(
    new RegExp(`- meter "${en.steer}"[^\\n]*\\n[\\s\\S]*- meter "${en.speed}"`),
  );

  await page.keyboard.press('4');
  await page.keyboard.press('w');
  await expect(lever).toHaveAttribute('aria-valuenow', '10');
  await expect(lever).toHaveAttribute('aria-valuetext', `10${NBSP}%`);
  await page.keyboard.down('a');
  await expect(wheel).toHaveAttribute(
    'aria-valuetext',
    new RegExp(`\\d+${NBSP}%${NBSP}${en.steerValueLeft}$`),
  );
  await page.keyboard.up('a');
  expect(Number(await wheel.getAttribute('aria-valuenow'))).toBeGreaterThan(0);

  for (const meter of [wheel, lever]) {
    expect(await meter.evaluate((el) => el.tabIndex)).toBe(-1);
  }
});

test('Tab from the last pause button wraps to Continue and keeps page focus', async ({ page }) => {
  await startDrive(page);
  await page.keyboard.press('Escape');
  const sheet = page.getByRole('dialog', { name: en.paused });
  await expect(sheet).toBeVisible();
  const buttons = sheet.getByRole('button');
  const resume = sheet.getByRole('button', { name: en.continue });
  await buttons.last().focus();
  await page.keyboard.press('Tab');
  await expect(resume).toBeFocused();
  expect(await resume.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  expect(await page.evaluate(() => document.hasFocus())).toBe(true);

  await page.keyboard.press('Shift+Tab');
  await expect(buttons.last()).toBeFocused();
});

test('the replay slider announces the visible time', async ({ page }) => {
  await startDrive(page);
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await page.getByRole('button', { name: en.replay }).click();
  const scrubber = page.getByRole('slider', { name: en.timeline });
  await expect(scrubber).toBeVisible();
  // The replay plays at once and a short run may already have ended: seeking to the end pauses it either way.
  const max = (await scrubber.getAttribute('max')) ?? '0';
  await scrubber.fill(max);
  await expect(page.getByRole('button', { name: en.play })).toBeVisible();
  const time = page.locator('.replay-time');
  await expect(time).toHaveText(/ \/ /);
  await scrubber.fill(String(Math.round(Number(max) / 2)));
  await expect
    .poll(async () => {
      const [valuetext, label] = [
        await scrubber.getAttribute('aria-valuetext'),
        await time.textContent(),
      ];
      return valuetext === label;
    })
    .toBe(true);
});

test('a notice ignores an Enter held from before it appeared', async ({ page, allow }) => {
  allow(/Graphics could not start/);
  await page.addInitScript(() => {
    const original: unknown = Reflect.get(HTMLCanvasElement.prototype, 'getContext');
    if (typeof original !== 'function') return;
    // The title's probe passes; the renderer's own context then fails.
    let probed = false;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value(this: HTMLCanvasElement, id: string, ...rest: unknown[]): unknown {
        if (id !== 'webgl2') return Reflect.apply(original, this, [id, ...rest]);
        if (probed) return null;
        probed = true;
        return Reflect.apply(original, this, [id, ...rest]);
      },
    });
  });
  await page.goto('./');
  await openSetup(page, en, exerciseEntry('straight-reverse'));
  await startControl(page, en, exerciseEntry('straight-reverse')).focus();
  await page.keyboard.down('Enter');
  const notice = page.getByRole('alertdialog', { name: en.noWebgl });
  await expect(notice).toBeVisible();
  await page.keyboard.down('Enter');
  await expect(notice).toBeVisible();
  await page.keyboard.up('Enter');
  await expect(notice).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: en.appName })).toBeVisible();
});

test.describe('German', () => {
  test.use({ locale: 'de-DE' });

  test('the wheel and the lever are named and valued in German', async ({ page }) => {
    await page.goto('./');
    await startExercise(page, de, 'straight-reverse');
    await expect(page.locator('[data-hud="speed"]')).toContainText('km/h');
    await expect(page.getByRole('meter', { name: de.steer })).toHaveAttribute(
      'aria-valuetext',
      de.steerValueStraight,
    );
    await page.keyboard.press('4');
    await page.keyboard.press('w');
    await expect(page.getByRole('meter', { name: de.speed })).toHaveAttribute(
      'aria-valuetext',
      `10${NBSP}%`,
    );
  });
});
