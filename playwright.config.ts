import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { WSL_LIB, wslGpuLaunch } from './e2e/gpu-launch';
import { previewPort } from './e2e/preview-port';
import { WEBGPU_LAUNCH } from './e2e/webgpu-launch';

const port = previewPort(import.meta.dirname);
if (process.env['TEST_WORKER_INDEX'] === undefined)
  console.log(`e2e preview port: ${String(port)}`);
const UAT_BUILD = 'DEPLOY_CHANNEL=uat BASE_PATH=/gegenlenker/uat/ pnpm build --outDir dist/uat';
const url = `http://127.0.0.1:${port}/gegenlenker/`;

// Browsers are headless unless `HEADED=1`: a headed window grabs focus on the desktop (WSLg shows it there).
// Opt-in `E2E_GPU=1` (WSL2 + NVIDIA) asks for the real GPU via Mesa d3d12 (`e2e/gpu-launch.ts`), headless too.
const HEADED = process.env['HEADED'] === '1';
const GPU = process.env['E2E_GPU'] === '1';
if (GPU && !existsSync(WSL_LIB))
  throw new Error('E2E_GPU=1 needs WSL2 with a GPU (no /usr/lib/wsl/lib)');
// Playwright's `chromium` channel is Chromium's new headless mode when headless.
const newHeadless = HEADED ? {} : { channel: 'chromium' as const };
const GPU_TEXT_METRICS =
  /below 700 px the brief collapses|open overlays stay whole.* 800x600 with a mouse|opening the aid legend re-measures/;
const wslGpu = existsSync(WSL_LIB) ? wslGpuLaunch(HEADED) : { args: [], env: process.env };
const gpuLaunch = {
  ...newHeadless,
  args: [
    ...wslGpu.args,
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--hide-scrollbars',
    ...(HEADED ? ['--window-position=-32000,-32000', '--no-startup-window'] : []),
  ],
  env: wslGpu.env,
};

export default defineConfig<{ gpuExpected: boolean }>({
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
        headless: !(GPU && HEADED),
        gpuExpected: GPU,
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
        headless: !HEADED,
        launchOptions: existsSync(WSL_LIB)
          ? gpuLaunch
          : { ...newHeadless, args: ['--ignore-gpu-blocklist'] },
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
