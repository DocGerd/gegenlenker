import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';

test('the replay scrubber seeks both ways and speeds include half speed', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
  await page.waitForTimeout(1000);
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(page.locator('[data-hud="speed"]')).not.toHaveText('0.0 km/h');
  // Long enough that replay playback cannot reach its end before the pause click lands.
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: en.pause }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await page.getByRole('button', { name: en.replay }).click();

  const scrubber = page.getByRole('slider', { name: en.timeline });
  const time = page.locator('.replay-time');
  await expect(scrubber).toBeVisible();
  // Pause first: a finished replay turns the pause button into a restart.
  await page.getByRole('button', { name: en.pause }).click();
  await expect(page.getByRole('button', { name: en.play })).toBeVisible();
  // Idle time before the first input is cut off: the timeline starts after step 0.
  const first = Number(await scrubber.getAttribute('min'));
  expect(first).toBeGreaterThan(0);
  const last = await scrubber.getAttribute('max');
  expect(Number(last)).toBeGreaterThan(0);

  await page.getByRole('button', { name: '0.5×' }).click();
  await expect(page.getByRole('button', { name: '0.5×' })).toHaveAttribute('aria-pressed', 'true');

  await scrubber.fill(last ?? '0');
  const total = (await time.textContent())?.split(' / ')[1] ?? '';
  await expect(time).toHaveText(`${total} / ${total}`);
  await scrubber.fill('0');
  await expect(scrubber).toHaveValue(String(first));
  await expect(time).toHaveText(`0.0 s / ${total}`);
});

test('a night run replays at night after the stored setting switched to day', async ({ page }) => {
  const SETTINGS_KEY = 'gegenlenker.settings.v1';
  await page.addInitScript((key) => {
    // Only the first load: the later reload must keep the day setting.
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ version: 1, graphics: 'low', lighting: 'night' }));
    }
  }, SETTINGS_KEY);
  const html = page.locator('html');
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(html).toHaveAttribute('data-render-lighting', 'night');
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: en.pause }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await expect(page.getByRole('button', { name: en.replay })).toBeVisible();

  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, graphics: 'low', lighting: 'day' }));
  }, SETTINGS_KEY);
  await page.reload();
  await expect(html).not.toHaveAttribute('data-render-lighting');
  await page.getByRole('button', { name: en.replayLastRun }).click();
  await expect(page.getByRole('slider', { name: en.timeline })).toBeVisible();
  await expect(html).toHaveAttribute('data-render-lighting', 'night');
});
