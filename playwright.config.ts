import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { previewPort } from './e2e/preview-port';
import { WEBGPU_LAUNCH } from './e2e/webgpu-launch';

const port = previewPort(import.meta.dirname);
if (process.env['TEST_WORKER_INDEX'] === undefined)
  console.log(`e2e preview port: ${String(port)}`);
const UAT_BUILD = 'DEPLOY_CHANNEL=uat BASE_PATH=/gegenlenker/uat/ pnpm build --outDir dist/uat';
const url = `http://127.0.0.1:${port}/gegenlenker/`;

// Opt-in `E2E_GPU=1` (WSL2 + NVIDIA): headed Chromium on the real GPU via Mesa d3d12 (headless has no GPU path).
const WSL_LIB = '/usr/lib/wsl/lib';
const GPU = process.env['E2E_GPU'] === '1';
if (GPU && !existsSync(WSL_LIB))
  throw new Error('E2E_GPU=1 needs WSL2 with a GPU (no /usr/lib/wsl/lib)');
const GPU_TEXT_METRICS =
  /below 700 px the brief collapses|open overlays stay whole.* 800x600 with a mouse|opening the aid legend re-measures/;
const gpuLaunch = {
  args: [
    '--use-gl=angle',
    '--use-angle=gl',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--hide-scrollbars',
    '--window-position=-32000,-32000',
  ],
  env: {
    ...process.env,
    GALLIUM_DRIVER: 'd3d12',
    LD_LIBRARY_PATH: [WSL_LIB, process.env['LD_LIBRARY_PATH']].filter(Boolean).join(':'),
  },
};

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  use: { baseURL: url, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'offline',
      testMatch: /\.spec\.ts$/,
      testIgnore: /\/(webgpu|channels)\//,
      // Headed Chromium lays HUD text out wider than headless, which breaks these short-viewport layout checks.
      ...(GPU ? { grepInvert: GPU_TEXT_METRICS } : {}),
      // High first-load markers on software GL outlast the 5 s default; a test fits several waits.
      expect: { timeout: 30_000 },
      timeout: 90_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        serviceWorkers: 'allow',
        headless: !GPU,
        launchOptions: GPU
          ? gpuLaunch
          : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
    {
      // Software WebGPU (SwiftShader) in Chromium's new headless mode; advisory in CI.
      name: 'webgpu',
      testMatch: /webgpu\/.*\.spec\.ts$/,
      expect: { timeout: 30_000 },
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        serviceWorkers: 'block',
        launchOptions: WEBGPU_LAUNCH,
      },
    },
    {
      // The production dist with a UAT build inside `uat/` (E2E_CHANNELS builds both).
      name: 'channels',
      testMatch: /channels\/.*\.spec\.ts$/,
      expect: { timeout: 30_000 },
      use: { ...devices['Desktop Chrome'], locale: 'en-US', serviceWorkers: 'allow' },
    },
    {
      name: 'perf',
      testMatch: /\.perf\.ts$/,
      timeout: 120_000,
      use: {
        ...devices['Galaxy Tab S9 landscape'],
        headless: false,
        launchOptions: { args: ['--ignore-gpu-blocklist'] },
      },
    },
  ],
  webServer: {
    // CI builds with BASE_PATH before this runs; locally the build happens here.
    command: `${process.env['CI'] ? '' : `pnpm build && ${process.env['E2E_CHANNELS'] ? `${UAT_BUILD} && ` : ''}`}pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
    env: { BASE_PATH: '/gegenlenker/' },
    url,
  },
});
