import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const entries = Object.values(pkg.scripts)
  .map((cmd) => /^node (\S+\.ts)(?:\s|$)/.exec(cmd)?.[1])
  .filter((path): path is string => path !== undefined);

describe('Node-run .ts entries', () => {
  it('are found', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s runs nothing when imported', async (entry) => {
    process.exitCode = undefined;
    await import(/* @vite-ignore */ resolve(ROOT, entry));
    expect(process.exitCode).toBeUndefined();
  });
});

describe('e2e/pinned-shoot.ts under plain Node', () => {
  // Vitest and Playwright resolve extensionless imports; scripts/shoot-views.mjs does not.
  it('imports through type stripping', () => {
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import('./e2e/pinned-shoot.ts').then((m) => console.log(Object.keys(m.readyMarkers('high')).length))",
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        killSignal: 'SIGKILL',
      },
    );
    expect(Number(out.trim())).toBeGreaterThan(1);
  });
});
