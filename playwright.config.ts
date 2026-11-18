import { createHash } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

// E2E_PORT overrides; otherwise a stable port per checkout (4400-4899) lets worktrees run e2e in parallel.
const port =
  process.env['E2E_PORT'] ??
  String(4400 + (createHash('sha256').update(process.cwd()).digest().readUInt32BE(0) % 500));
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
      testMatch: /(offline|layout|follow-framing|chase|pause|replay|retry|webgl)\.spec\.ts$/,
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
