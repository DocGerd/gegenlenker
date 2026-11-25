import { createHash } from 'node:crypto';
import { expect, test } from '../fixtures';
import { QUALITY_FLAGS } from '../../src/render/quality';
import type { LightingMode } from '../../src/contracts/render';
import {
  distinctColours,
  HIGH_WAIT_MS,
  MIN_DRAWN_COLOURS,
  PRESET_TIMEOUT_MS,
  shoot,
  step,
  startPinnedDrive,
  WEBGPU_SETTLE_DEADLINE_MS,
  type Preset,
} from '../pinned-shoot';
import { exerciseEntry } from '../menu-flow';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const LIGHTINGS: readonly LightingMode[] = ['day', 'night'];
const TOP_DOWN = ['follow', 'yard'] as const;
/** Frames the chase view draws, so its pipelines are built and any WGSL error is logged. */
const VIEW_FRAMES = 30;

const sha = (png: Buffer): string => createHash('sha256').update(png).digest('hex');

// Every pipeline of every view must build on WebGPU: three logs a failed one as `THREE.` (the
// fixtures guard fails the test on it) and still draws the app. The top-down panes must come out
// the same at every preset, as they do on WebGL2 (`e2e/topdown-invariance.spec.ts`). Software
// adapter, so no timings are asserted.
for (const lighting of LIGHTINGS) {
  test(`${lighting} runs on WebGPU and draws the same top-down view at every preset`, async ({
    context,
  }, testInfo) => {
    test.setTimeout(
      PRESETS.reduce(
        (sum, preset) =>
          sum + PRESET_TIMEOUT_MS[preset] + 2 * 2 * WEBGPU_SETTLE_DEADLINE_MS[preset],
        0,
      ),
    );
    const hashes = new Map<string, string>();
    for (const preset of PRESETS) {
      const page = await context.newPage();
      const html = page.locator('html');
      await startPinnedDrive(
        page,
        { preset, lighting },
        exerciseEntry('straight-reverse'),
        '?backend=webgpu',
      );
      await expect(html).toHaveAttribute('data-render-backend', 'webgpu', {
        timeout: HIGH_WAIT_MS,
      });
      await expect(html).not.toHaveAttribute('data-render-fallback');

      // `shoot` draws the two top-down views; the chase view is the only one left out.
      if (QUALITY_FLAGS[preset].chaseView) {
        await page.keyboard.press('o');
        await expect(page.locator('[data-view="chase"][aria-pressed="true"]')).toBeVisible();
        await step(page, VIEW_FRAMES);
      }

      for (const shot of TOP_DOWN) {
        const png = await shoot(page, shot);
        const name = `${lighting} ${preset} ${shot}`;
        await testInfo.attach(`${name}.png`, { body: png, contentType: 'image/png' });
        expect(await distinctColours(page, png), name).toBeGreaterThan(MIN_DRAWN_COLOURS);
        hashes.set(name, sha(png));
      }
      await expect(html).toHaveAttribute('data-render-backend', 'webgpu');
      await expect(html).not.toHaveAttribute('data-render-fallback');
      await page.close();
    }
    for (const shot of TOP_DOWN) {
      const [first, ...rest] = PRESETS;
      const base = hashes.get(`${lighting} ${String(first)} ${shot}`);
      for (const preset of rest) {
        expect(
          hashes.get(`${lighting} ${preset} ${shot}`),
          `${shot}: ${String(first)} vs ${preset}`,
        ).toBe(base);
      }
    }
  });
}
