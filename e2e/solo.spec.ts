import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { TRAILER_IDS } from '../src/contracts/vehicle';
import { en } from '../src/i18n/en';
import { chooseRunOption, exerciseEntry, setupBests, startExercise, toTitle } from './menu-flow';
import { reachedResult, seedStorage } from './menu-seed';

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
  await expect(page.locator('.result-values')).toContainText(en.contacts);
  await expect(page.locator('.result-values')).not.toContainText(en.jackknifes);

  // The stored choice and the stored run both load again as solo.
  await page.reload();
  await toTitle(page, en);
  await expect(titleEntry(page, en.continue)).toContainText(en.noTrailer);
  await titleEntry(page, en.replayLastRun).click();
  await expect(page.getByRole('slider', { name: en.timeline })).toBeVisible();
});

test('a solo finish is done and shown apart from trailer runs', async ({ page }) => {
  const solo = { ...reachedResult('reverse-bay'), trailerId: null };
  await seedStorage(page, { settings: { graphics: 'low', solo: true }, best: [solo] });
  await page.goto('./');
  const reverseBay = (): Locator =>
    page
      .locator('[data-screen="exercises"]')
      .getByRole('button', { name: new RegExp(`^${en.exerciseReverseBay}`) });

  await titleEntry(page, en.exercises).click();
  await expect(reverseBay()).toContainText(en.exerciseDone);
  await reverseBay().click();
  const bests = setupBests(page, en, exerciseEntry('reverse-bay'));
  await expect(bests).toContainText(en.contacts);
  await expect(bests).not.toContainText(en.jackknifes);

  await chooseRunOption(page, en, 'trailer', TRAILER_IDS[0]);
  await expect(bests).toContainText(en.noResult);
  await toTitle(page, en);
  await titleEntry(page, en.exercises).click();
  await expect(reverseBay()).toBeVisible();
  await expect(reverseBay()).not.toContainText(en.exerciseDone);
});
