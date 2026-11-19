// Stops the process listening on this checkout's e2e preview port (or --port <n>), and nothing else.
// Usage: pnpm preview:stop [--port <n>]
// Replaces broad `pkill -f "vite preview"`, which also kills other worktrees' servers.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { setTimeout } from 'node:timers';
import { listenerPids, previewPort } from '../e2e/preview-port.ts';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const listening = (port) => {
  const ss = spawnSync('ss', ['-H', '-ltnp', `sport = :${port}`], { encoding: 'utf8' });
  if (ss.error !== undefined || ss.status !== 0)
    throw new Error(`ss failed: ${ss.error?.message ?? ss.stderr.trim()}`);
  return ss.stdout.trim();
};

const stop = async (port) => {
  const out = listening(port);
  if (out === '') {
    console.log(`port ${port}: nothing listening`);
    return true;
  }
  const pids = listenerPids(out);
  if (pids.length === 0) {
    console.error(`port ${port}: a listener exists but its pid is not visible (not ours?)\n${out}`);
    return false;
  }
  let ok = true;
  for (const pid of pids) {
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 30 && alive(pid); i++) await sleep(100);
    if (alive(pid)) {
      process.kill(pid, 'SIGKILL');
      console.log(`port ${port}: pid ${pid} ignored SIGTERM, killed`);
    } else console.log(`port ${port}: stopped pid ${pid}`);
  }
  if (listening(port) !== '') {
    console.error(`port ${port}: still listening after stop`);
    ok = false;
  }
  return ok;
};

const { values } = parseArgs({ options: { port: { type: 'string' } } });
let port;
if (values.port === undefined) port = previewPort(join(import.meta.dirname, '..'));
else {
  port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port must be an integer in 1-65535, got "${values.port}"`);
    process.exit(2);
  }
}
process.exit((await stop(port)) ? 0 : 1);
