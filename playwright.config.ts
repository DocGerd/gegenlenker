import { defineConfig, devices } from '@playwright/test';
import { previewPort } from './e2e/preview-port';

const port = previewPort(import.meta.dirname);
if (process.env['TEST_WORKER_INDEX'] === undefined)
  console.log(`e2e preview port: ${String(port)}`);
const url = `http://127.0.0.1:${port}/gegenlenker/`;

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
      // High first-load markers on software GL outlast the 5 s default, and the multisample sRGB frame
      // target makes each software frame slower still; a test fits several waits.
      expect: { timeout: 60_000 },
      timeout: 150_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        serviceWorkers: 'allow',
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
        },
      },
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
    command: `${process.env['CI'] ? '' : 'pnpm build && '}pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
    env: { BASE_PATH: '/gegenlenker/' },
    url,
  },
});
