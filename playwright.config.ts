import { createHash } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { OFFLINE_SPECS } from './e2e/offline-specs';

// E2E_PORT overrides; otherwise a stable port per checkout lets worktrees run e2e in parallel.
const previewPort = (): number => {
  const raw = process.env['E2E_PORT'];
  if (raw === undefined || raw === '') {
    const hash = createHash('sha256')
      .update(import.meta.dirname)
      .digest()
      .readUInt32BE(0);
    return 4400 + (hash % 20000);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error(`E2E_PORT must be an integer in 1024-65535, got "${raw}"`);
  return value;
};
const port = previewPort();
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
      testMatch: OFFLINE_SPECS,
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
