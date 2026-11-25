import { describe, expect, it } from 'vitest';
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
