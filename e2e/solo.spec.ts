import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { startExercise, toTitle } from './menu-flow';
import { seedStorage } from './menu-seed';

const titleEntry = (page: Page, name: string): Locator =>
  page.locator('[data-screen="title"]').getByRole('button', { name });

test('the truck drives solo without the angle display, finishes and replays', async ({ page }) => {
  await seedStorage(page, { settings: { graphics: 'low' } });
  await page.goto('./');
  await startExercise(page, en, 'reverse-bay', { trailer: 'none' });

  // No trailer, so no angles: the angle display, its legend line, the gauges and the limit-stop counter are gone.
  await expect(page.locator('[data-hud="contacts"]')).toBeVisible();
  await expect(page.locator('[data-hud="jackknifes"]')).toHaveCount(0);
  await expect(page.locator('[data-aid]')).toHaveCount(3);
  await expect(page.locator('[data-aid="pivots"]')).toHaveCount(0);
  await expect(page.locator('[data-aid-legend="pivots"]')).toHaveCount(0);
  await expect(page.locator('[data-panel="gauges"]')).toHaveCount(0);
  await expect(page.locator('.hud-gauge')).toHaveCount(0);
  await expect(page.locator('[data-aid-legend="ghost"]')).toHaveText(en.legendGhostSolo);

  await page.keyboard.press('2');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await page.getByRole('button', { name: en.pause }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();

  // The stored choice and the stored run both load again as solo.
  await page.reload();
  await toTitle(page, en);
  await expect(titleEntry(page, en.continue)).toContainText(en.noTrailer);
  await titleEntry(page, en.replayLastRun).click();
  await expect(page.getByRole('slider', { name: en.timeline })).toBeVisible();
});
