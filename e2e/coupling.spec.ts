import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { exerciseEntry, openSetup, runOptionValue, startControl } from './menu-flow';
import { seedStorage } from './menu-seed';

const COUPLE_MS = 30_000;

const uncoupleKey = (page: Page) => page.locator('.hud-legend dt').filter({ hasText: /^U$/ });

// The smallest supported landscape screen: the goal card's button has to fit there too.
test.use({ viewport: { width: 800, height: 585 } });

test('the truck couples to the parked trailer, uncouples by key and button, and is scored on its approach', async ({
  page,
}) => {
  // solo is kept for the other exercises; this one couples to the kept trailer
  await seedStorage(page, { settings: { graphics: 'low', solo: true } });
  await page.goto('./');
  const entry = exerciseEntry('coupling');
  await openSetup(page, en, entry);
  const setup = page.locator('[data-screen="setup"]');
  await expect(setup.locator('[data-menu="role"]')).toHaveCount(0);
  await expect(setup.locator('[data-menu="trailer"] input[value="none"]')).toHaveCount(0);
  expect(await runOptionValue(page, en, 'trailer')).not.toBe('none');
  await startControl(page, en, entry).click();

  const hitch = page.locator('[data-hud="hitch"]');
  const uncouple = page.getByRole('button', { name: en.uncouple });
  await expect(hitch).toHaveText(en.notCoupled);
  await expect(uncouple).toBeDisabled();
  // the short screen's key list names the key, though its compact column drops the view rows
  const keysToggle = page.locator('[data-hud="keysToggle"]');
  await keysToggle.click();
  await expect(uncoupleKey(page)).toBeVisible();
  await keysToggle.click();
  await expect(uncoupleKey(page)).toBeHidden();
  // the button's link shows the state: open, closed while coupled
  await expect(uncouple).not.toHaveAttribute('data-coupled');
  await expect(page.locator('.drive')).not.toHaveAttribute('data-solo');

  // Reverse onto the eye at full lever: the jaw closes, too fast for a clean coupling.
  await page.keyboard.press('2');
  for (let i = 0; i < 10; i++) await page.keyboard.press('w');
  await expect(hitch).toHaveText(en.coupled, { timeout: COUPLE_MS });
  await expect(uncouple).toHaveAttribute('data-coupled');
  await page.keyboard.press('Space');
  await expect(uncouple).toBeEnabled();
  await page.keyboard.press('u');
  await expect(hitch).toHaveText(en.notCoupled);
  await expect(uncouple).toBeDisabled();
  await expect(uncouple).not.toHaveAttribute('data-coupled');

  // The jaw stands at the eye: a creep back couples again, and the button uncouples.
  await page.keyboard.press('w');
  await expect(hitch).toHaveText(en.coupled);
  await page.keyboard.press('Space');
  await uncouple.click();
  await expect(hitch).toHaveText(en.notCoupled);

  await page.getByRole('button', { name: en.pause }).click();
  await page
    .getByRole('dialog', { name: en.paused })
    .getByRole('button', { name: en.finish })
    .click();
  await expect(page.getByRole('heading', { name: en.targetMissed })).toBeVisible();
  const speed = page.locator('.result-row').filter({ hasText: en.couplingSpeed });
  await expect(speed.locator('.result-bad')).toContainText('km/h');

  // Continue starts it again with the kept trailer, solo or not
  await page.getByRole('button', { name: en.menu, exact: true }).click();
  const resume = page.locator('[data-screen="title"]').getByRole('button', { name: en.continue });
  await expect(resume).toContainText(en.exerciseCoupling);
  await expect(resume).not.toContainText(en.noTrailer);

  // an exercise without a trailer to couple lists no uncouple key
  const other = exerciseEntry('straight-reverse');
  await openSetup(page, en, other);
  await startControl(page, en, other).click();
  await expect(page.locator('.hud-legend dt').filter({ hasText: /^C$/ })).toHaveCount(1);
  await expect(uncoupleKey(page)).toHaveCount(0);
});
