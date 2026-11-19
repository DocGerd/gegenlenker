import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/en';

test('shows a notice and loads no renderer when WebGL 2 is missing', async ({ page }) => {
  await page.addInitScript(() => {
    const original: unknown = Reflect.get(HTMLCanvasElement.prototype, 'getContext');
    if (typeof original !== 'function') return;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value(this: HTMLCanvasElement, id: string, ...rest: unknown[]): unknown {
        return id === 'webgl2' ? null : Reflect.apply(original, this, [id, ...rest]);
      },
    });
  });
  const chunks: string[] = [];
  page.on('request', (r) => {
    if (/\/assets\/drive-/.test(r.url())) chunks.push(r.url());
  });

  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.getByText(en.noWebgl)).toBeVisible();
  expect(chunks).toEqual([]);

  await page.getByRole('button', { name: en.back }).click();
  await expect(page.getByRole('heading', { name: en.appName })).toBeVisible();
});

test('a WebGPU request without a WebGPU adapter drives on WebGL 2 without a notice', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: () => Promise.resolve(null) },
    });
  });
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().startsWith('THREE.')) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));

  await page.goto('./?backend=webgpu');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('html')).toHaveAttribute('data-render-backend', 'webgl2');
  await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(2);
  await expect(page.locator('.app-notice')).toHaveCount(0);
  expect(problems).toEqual([]);
});
