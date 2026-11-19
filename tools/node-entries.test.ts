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
