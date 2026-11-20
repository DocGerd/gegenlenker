import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
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

/**
 * A stand-in `navigator.gpu` (CI's Chromium has none): `none` offers no adapter, `lost` a device
 * that is already lost, so the WebGPU start fails after a device exists. Counts adapter requests
 * and destroyed devices on `window`.
 */
async function stubGpu(page: Page, kind: 'none' | 'lost'): Promise<string[]> {
  await page.addInitScript((k) => {
    const seen = { adapters: 0, destroyed: 0 };
    Object.assign(window, { gpuSeen: seen });
    const device = {
      features: new Set<string>(),
      limits: {},
      lost: Promise.resolve({ reason: 'unknown', message: 'stub loss' }),
      destroy: () => {
        seen.destroyed++;
      },
    };
    const adapter = {
      features: new Set<string>(),
      info: { vendor: 'stub', architecture: '', description: '', isFallbackAdapter: false },
      requestDevice: () => Promise.resolve(device),
    };
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: () => {
          seen.adapters++;
          return Promise.resolve(k === 'none' ? null : adapter);
        },
      },
    });
  }, kind);
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().startsWith('THREE.')) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

const gpuSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { gpuSeen: unknown }).gpuSeen);

async function drive(page: Page, search: string): Promise<void> {
  await page.goto(`./${search}`);
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('.hud-mirror:not([hidden])')).toHaveCount(2);
  await expect(page.locator('.app-notice')).toHaveCount(0);
}

test('asks for no WebGPU adapter unless the page asks for WebGPU', async ({ page }) => {
  const problems = await stubGpu(page, 'none');
  await drive(page, '');
  await expect(page.locator('html')).toHaveAttribute('data-render-backend', 'webgl2');
  await expect(page.locator('html')).not.toHaveAttribute('data-render-fallback');
  expect(await gpuSeen(page)).toMatchObject({ adapters: 0 });
  expect(problems).toEqual([]);
});

test('a WebGPU request without a WebGPU adapter drives on WebGL 2 without a notice', async ({
  page,
}) => {
  const problems = await stubGpu(page, 'none');
  await drive(page, '?backend=webgpu');
  await expect(page.locator('html')).toHaveAttribute('data-render-backend', 'webgl2');
  await expect(page.locator('html')).toHaveAttribute('data-render-fallback', 'unavailable');
  expect(await gpuSeen(page)).toMatchObject({ adapters: 1 });
  expect(problems).toEqual([]);
});

test('a WebGPU start that fails after a device exists retries WebGL 2 on the same canvas', async ({
  page,
}) => {
  const problems = await stubGpu(page, 'lost');
  await drive(page, '?backend=webgpu');
  await expect(page.locator('html')).toHaveAttribute('data-render-backend', 'webgl2');
  await expect(page.locator('html')).toHaveAttribute('data-render-fallback', 'failed');
  await expect.poll(() => gpuSeen(page)).toMatchObject({ adapters: 1, destroyed: 1 });
  expect(problems).toEqual([]);
});
