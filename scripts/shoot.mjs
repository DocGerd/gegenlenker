// Build, preview, shoot, tear down: one command around scripts/shoot-views.mjs.
// Usage: pnpm shoot <shoot-views args except --url>, e.g. pnpm shoot --out shots --backend webgpu
// Builds with BASE_PATH=/gegenlenker/, serves on a free port (never the e2e one) and always stops
// its own server, also on a signal. Shoot-views' --diff-only mode needs no server: run it directly.
import { spawn, spawnSync } from 'node:child_process';
import console from 'node:console';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
if (args.some((a) => a === '--url' || a.startsWith('--url='))) {
  console.error('pnpm shoot serves its own build: drop --url');
  process.exit(2);
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const env = { ...process.env, BASE_PATH: '/gegenlenker/' };
const build = spawnSync('pnpm', ['build'], { cwd: root, env, stdio: 'inherit' });
if (build.status !== 0) {
  console.error('build failed');
  process.exit(1);
}

const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(vite)) throw new Error(`${vite} missing: run pnpm install`);
const port = await freePort();
const url = `http://127.0.0.1:${port}/gegenlenker/`;
const server = spawn(
  process.execPath,
  [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] },
);
let shooter;
let code = 1;
const stopAll = () => {
  shooter?.kill('SIGTERM');
  server.kill('SIGTERM');
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopAll();
    process.exit(128 + { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal]);
  });
}
process.on('exit', stopAll);

try {
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    if (server.exitCode !== null) throw new Error(`preview exited with ${server.exitCode}`);
    up = await globalThis.fetch(url).then(
      (r) => r.ok,
      () => false,
    );
    if (!up) await sleep(200);
  }
  if (!up) throw new Error(`preview not answering at ${url}`);
  console.log(`serving ${url}`);
  shooter = spawn(
    process.execPath,
    [join(root, 'scripts', 'shoot-views.mjs'), '--url', url, ...args],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  code = await new Promise((resolve) => {
    shooter.once('error', (e) => {
      console.error(e.message);
      resolve(1);
    });
    shooter.once('exit', (c, s) => resolve(c ?? (s === null ? 1 : 128)));
  });
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  stopAll();
}
process.exit(code);
