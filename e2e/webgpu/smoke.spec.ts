import { expect, test } from '../fixtures';
import { en } from '../../src/i18n/en';
import { QUALITY_FLAGS } from '../../src/render/quality';
import {
  HIGH_WAIT_MS,
  PRESET_TIMEOUT_MS,
  step,
  startPinnedDrive,
  WEBGPU_SETTLE_DEADLINE_MS,
  type Preset,
} from '../pinned-shoot';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
/** Frames each view draws before the next, so its pipelines are built and any WGSL error is logged. */
const VIEW_FRAMES = 30;

// Every pipeline of every view must build on WebGPU: three logs a failed one as `THREE.` (the
// fixtures guard fails the test on it) and still draws the app. Software adapter, so no timings
// or pixels are asserted.
for (const preset of PRESETS) {
  test(`${preset} runs on WebGPU`, async ({ page }) => {
    test.setTimeout(PRESET_TIMEOUT_MS[preset] + 2 * 2 * WEBGPU_SETTLE_DEADLINE_MS[preset]);
    const html = page.locator('html');
    await startPinnedDrive(
      page,
      { preset, lighting: 'day' },
      en.exerciseStraightReverse,
      '?backend=webgpu',
    );
    await expect(html).toHaveAttribute('data-render-backend', 'webgpu', {
      timeout: HIGH_WAIT_MS,
    });
    await expect(html).not.toHaveAttribute('data-render-fallback');

    const views = [
      ['yard', 'y'],
      ...(QUALITY_FLAGS[preset].chaseView ? [['chase', 'o']] : []),
      ['follow', 'f'],
    ] as const;
    for (const [view, key] of views) {
      await page.keyboard.press(key);
      await expect(page.locator(`[data-view="${view}"][aria-pressed="true"]`)).toBeVisible();
      await step(page, VIEW_FRAMES);
    }
    await expect(html).toHaveAttribute('data-render-backend', 'webgpu');
    await expect(html).not.toHaveAttribute('data-render-fallback');
  });
}
