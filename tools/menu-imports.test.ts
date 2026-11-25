import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { importChain, type Edge } from './import-graph.ts';

// Loaded by dynamic import once a drive or replay starts.
const STOPS = ['src/app/drive.ts', 'src/app/replay-view.ts'];

const bad = ({ specifier, path }: Edge): boolean =>
  /^three(\/|$)/.test(specifier) ||
  path === 'src/render/index.ts' ||
  path?.startsWith('src/hud/') === true ||
  STOPS.includes(path ?? '');

describe('app shell import graph', () => {
  it('the app shell loads no three, render index, hud, drive or replay before a drive or replay starts', () => {
    expect(
      importChain(
        'src/app/app.ts',
        bad,
        ({ path, dynamic }) => !(dynamic && STOPS.includes(path ?? '')),
      ),
    ).toBeUndefined();
  });
});

describe('importChain', () => {
  // Under the repo root (git-ignored), because the walker resolves repo-relative paths.
  const root = join(import.meta.dirname, '..');
  const dir = mkdtempSync(join(root, 'node_modules', '.import-graph-'));
  const rel = relative(root, dir);
  const write = (name: string, text: string): string => {
    writeFileSync(join(dir, name), text);
    return `${rel}/${name}`;
  };
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const forbidden = write('forbidden.ts', 'export const x = 1;\n');
  const isForbidden = ({ path }: Edge): boolean => path === forbidden;
  const skipDynamic = ({ path, dynamic }: Edge): boolean => !(dynamic && path === forbidden);

  it('names the chain to a static import of a forbidden module', () => {
    const mid = write('mid.ts', "import './forbidden';\n");
    const entry = write('static-entry.ts', "import './mid';\n");
    expect(importChain(entry, isForbidden, skipDynamic)).toEqual([entry, mid, forbidden]);
  });

  it('skips a dynamic import of a forbidden module', () => {
    const entry = write('dynamic-entry.ts', "void import('./forbidden');\n");
    expect(importChain(entry, isForbidden, skipDynamic)).toBeUndefined();
    expect(importChain(entry, isForbidden, () => true)).toEqual([entry, forbidden]);
  });
});
