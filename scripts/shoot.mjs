// Build, preview, shoot, tear down: one command around scripts/shoot-views.mjs.
// Usage: pnpm shoot <shoot-views args except --url>, e.g. pnpm shoot --out shots --backend webgpu
// Builds with BASE_PATH=/gegenlenker/, serves on a free port (never the e2e one) and stops its own
// server and shooter on exit, also on a signal. It rebuilds dist/, so do not run it beside
// `pnpm test:e2e` in one checkout. Shoot-views' --diff-only mode needs no server: run it directly.
import { spawn } from 'node:child_process';
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
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(vite)) {
  console.error(`${vite} missing: run pnpm install`);
  process.exit(1);
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
const gone = (child) => child.exitCode !== null || child.signalCode !== null;
/** Resolves with the exit code (128 when killed by a signal), or 1 when it cannot start. */
const finished = (child) =>
  new Promise((resolve) => {
    child.once('error', (e) => {
      console.error(e.message);
      resolve(1);
    });
    child.once('exit', (code, signal) => resolve(code ?? (signal === null ? 1 : 128)));
  });

const children = new Set();
const run = (command, argv, options) => {
  const child = spawn(command, argv, { cwd: root, ...options });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
};
/** SIGTERM every live child, wait for it, and SIGKILL what ignores that. */
const stopAll = async () => {
  const live = [...children].filter((c) => !gone(c));
  for (const child of live) child.kill('SIGTERM');
  const deadline = Date.now() + 3000;
  while (live.some((c) => !gone(c)) && Date.now() < deadline) await sleep(50);
  for (const child of live) if (!gone(child)) child.kill('SIGKILL');
};
let stopping = false;
const shutdown = async (code) => {
  if (stopping) return;
  stopping = true;
  await stopAll();
  process.exit(code);
};
for (const [signal, n] of [
  ['SIGINT', 2],
  ['SIGTERM', 15],
  ['SIGHUP', 1],
])
  process.on(signal, () => void shutdown(128 + n));
// Last resort when something calls process.exit: only synchronous work runs here.
process.on('exit', () => {
  for (const child of children) if (!gone(child)) child.kill('SIGKILL');
});

const env = { ...process.env, BASE_PATH: '/gegenlenker/' };
let code = 1;
try {
  const built = await finished(run('pnpm', ['build'], { env, stdio: 'inherit' }));
  if (built !== 0) throw new Error(`build failed (exit ${built})`);

  const port = await freePort();
  const url = `http://127.0.0.1:${port}/gegenlenker/`;
  const server = run(
    process.execPath,
    [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { env, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  server.once('error', (e) => console.error(`preview: ${e.message}`));
  let last = 'no answer';
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    if (gone(server))
      throw new Error(`preview exited (${server.exitCode ?? server.signalCode}): ${last}`);
    try {
      const response = await globalThis.fetch(url, {
        signal: globalThis.AbortSignal.timeout(1000),
      });
      last = `HTTP ${response.status}`;
      up = response.ok;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    if (!up) await sleep(200);
  }
  if (!up) throw new Error(`preview not answering at ${url}: ${last}`);
  if (gone(server)) throw new Error(`preview exited (${server.exitCode ?? server.signalCode})`);
  console.log(`serving ${url}`);
  code = await finished(
    run(process.execPath, [join(root, 'scripts', 'shoot-views.mjs'), '--url', url, ...args], {
      stdio: 'inherit',
    }),
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
}
await shutdown(code);
