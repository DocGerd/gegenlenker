// Stops the process listening on this checkout's e2e preview port (E2E_PORT, else derived from the
// checkout path) or on --port <n>. It acts on that one port only; on the default port it also
// requires the listener to have started in this checkout, while --port stops whatever listens.
// Usage: pnpm preview:stop [--port <n>]
// Replaces broad `pkill -f "vite preview"`, which also kills other worktrees' servers.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { readlinkSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { parseArgs } from 'node:util';
import { listenerPids, previewPort } from '../e2e/preview-port.ts';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** EPERM means the process exists but belongs to someone else. */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
const waitGone = async (pid, ms) => {
  for (let waited = 0; waited < ms && alive(pid); waited += 100) await sleep(100);
  return !alive(pid);
};
/** True when the signal landed or the pid is already gone; false after reporting why not. */
const signal = (pid, name) => {
  try {
    process.kill(pid, name);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return true;
    console.error(`pid ${pid}: ${name} failed (${e.code ?? e.message})`);
    return false;
  }
};

const listening = (port) => {
  const ss = spawnSync('ss', ['-H', '-ltnp', `sport = :${port}`], { encoding: 'utf8' });
  if (ss.error !== undefined || ss.status !== 0)
    throw new Error(`ss failed (needs Linux iproute2): ${ss.error?.message ?? ss.stderr.trim()}`);
  return ss.stdout.trim();
};

/** On the derived port a stranger may listen: act only on a process started in this checkout. */
const foreign = (pid, root) => {
  try {
    return readlinkSync(`/proc/${pid}/cwd`) !== root;
  } catch {
    return true;
  }
};

const stop = async (port, root) => {
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
    if (root !== undefined && foreign(pid, root)) {
      console.error(
        `port ${port}: pid ${pid} did not start in ${root}; use --port ${port} to stop it`,
      );
      ok = false;
      continue;
    }
    if (!signal(pid, 'SIGTERM')) {
      ok = false;
      continue;
    }
    if (await waitGone(pid, 3000)) console.log(`port ${port}: stopped pid ${pid}`);
    else if (signal(pid, 'SIGKILL') && (await waitGone(pid, 2000)))
      console.log(`port ${port}: pid ${pid} ignored SIGTERM, killed`);
    else {
      console.error(`port ${port}: pid ${pid} is still running`);
      ok = false;
    }
  }
  for (let i = 0; i < 20 && ok && listening(port) !== ''; i++) await sleep(100);
  if (ok && listening(port) !== '') {
    console.error(`port ${port}: still listening after stop`);
    ok = false;
  }
  return ok;
};

try {
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { port: { type: 'string' } } }));
  } catch (e) {
    console.error(`${e.message}\nusage: pnpm preview:stop [--port <n>]`);
    process.exit(2);
  }
  let port;
  let root;
  if (values.port === undefined) {
    root = join(import.meta.dirname, '..');
    try {
      port = previewPort(root);
    } catch (e) {
      console.error(e.message);
      process.exit(2);
    }
    const via = process.env['E2E_PORT'] ? 'E2E_PORT' : `derived from ${root}`;
    console.log(`port ${port} (${via})`);
  } else {
    port = Number(values.port);
    if (!/^\d+$/.test(values.port) || port < 1024 || port > 65535) {
      console.error(`--port must be an integer in 1024-65535, got "${values.port}"`);
      process.exit(2);
    }
  }
  process.exit((await stop(port, root)) ? 0 : 1);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(3);
}
