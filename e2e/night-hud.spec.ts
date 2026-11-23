import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { HEAVY, shoot, startPinnedDrive, settle, timeoutWithSettles } from './pinned-shoot';

const sha = (png: Buffer): string => createHash('sha256').update(png).digest('hex');
const SHOTS = ['follow', 'yard'] as const;

const html = (page: Page) => page.locator('html');

async function topDownHashes(page: Page): Promise<string[]> {
  const hashes: string[] = [];
  for (const shot of SHOTS) hashes.push(sha(await shoot(page, shot)));
  return hashes;
}

test(
  'a night drive under System theme draws the HUD dark on a light OS, the top-down view unchanged',
  { tag: HEAVY },
  async ({ context }) => {
    test.setTimeout(timeoutWithSettles('low', 3));
    const night = { preset: 'low', lighting: 'night' } as const;

    const system = await context.newPage();
    await system.emulateMedia({ colorScheme: 'light' });
    await startPinnedDrive(system, night, en.layoutDepot);
    await expect(html(system)).toHaveAttribute('data-theme', 'dark');
    await expect(system.locator('.hud-view-label').first()).toHaveCSS(
      'background-color',
      'rgb(21, 23, 26)',
    );
    const dark = await topDownHashes(system);

    const light = await context.newPage();
    await light.emulateMedia({ colorScheme: 'light' });
    await startPinnedDrive(light, { ...night, theme: 'light' }, en.layoutDepot);
    await expect(html(light)).toHaveAttribute('data-theme', 'light');
    expect(await topDownHashes(light), 'top-down shots follow the HUD theme').toEqual(dark);
    await light.close();

    await system.locator('[data-hud="action"]').click();
    await system
      .getByRole('dialog', { name: en.paused })
      .getByRole('button', { name: en.menu })
      .click();
    await expect(html(system)).toHaveAttribute('data-theme', 'light');

    await system.getByRole('combobox', { name: en.lighting }).selectOption('day');
    await system.getByRole('button', { name: new RegExp(`^${en.layoutDepot}`) }).click();
    await expect(html(system)).toHaveAttribute('data-render-lighting', 'day');
    await settle(system, 'low');
    await expect(html(system)).toHaveAttribute('data-theme', 'light');
  },
);
