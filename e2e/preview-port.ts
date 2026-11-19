import { createHash } from 'node:crypto';

// Imported by scripts/preview-stop.mjs through Node's type stripping: no enums, type-only imports.

/** E2E_PORT overrides; otherwise a stable port per checkout lets worktrees run e2e in parallel. */
export const previewPort = (root: string, env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env['E2E_PORT'];
  if (raw === undefined || raw === '') {
    const hash = createHash('sha256').update(root).digest().readUInt32BE(0);
    return 4400 + (hash % 20000);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error(`E2E_PORT must be an integer in 1024-65535, got "${raw}"`);
  return value;
};

/** Pids named by `ss -H -ltnp` output; a listener whose pid ss cannot show yields none. */
export const listenerPids = (ssOutput: string): number[] => [
  ...new Set([...ssOutput.matchAll(/\bpid=(\d+)/g)].map((m) => Number(m[1]))),
];
