import { defineConfig, devices } from '@playwright/test';

const url = 'http://127.0.0.1:4399/gegenlenker/';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  use: { baseURL: url, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'offline',
      testMatch: /(offline|layout|follow-framing|pause)\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        serviceWorkers: 'allow',
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
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
    command: `${process.env['CI'] ? '' : 'pnpm build && '}pnpm preview --host 127.0.0.1 --port 4399 --strictPort`,
    env: { BASE_PATH: '/gegenlenker/' },
    url,
  },
});
