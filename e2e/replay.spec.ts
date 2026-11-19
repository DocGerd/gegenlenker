import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';

test('the replay scrubber seeks both ways and speeds include half speed', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
  await page.keyboard.press('4');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(page.locator('[data-hud="speed"]')).not.toHaveText('0.0 km/h');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: en.finish }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await page.getByRole('button', { name: en.replay }).click();

  const scrubber = page.getByRole('slider', { name: en.timeline });
  const time = page.locator('.replay-time');
  await expect(scrubber).toBeVisible();
  const last = await scrubber.getAttribute('max');
  expect(Number(last)).toBeGreaterThan(0);

  await page.getByRole('button', { name: '0.5×' }).click();
  await expect(page.getByRole('button', { name: '0.5×' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: en.pause }).click();

  await scrubber.fill(last ?? '0');
  const total = (await time.textContent())?.split(' / ')[1] ?? '';
  await expect(time).toHaveText(`${total} / ${total}`);
  await scrubber.fill('0');
  await expect(time).toHaveText(`0.0 s / ${total}`);
});
