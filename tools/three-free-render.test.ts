import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importChain, resolveRelative, runtimeSpecifiers } from './import-graph.ts';
import { THREE_FREE_RENDER } from './three-free-render.ts';

const ROOT = join(import.meta.dirname, '..');
const THREE = /^three(\/|$)/;
// The render modules the app shell loads (`render-stage`, `drive`, `main`, the update prompt): the renderer uses Three.js;
// `asset-urls` only names its files with `?url` imports and loads none of its code.
const RENDERER_ENTRIES = ['src/render/index.ts', 'src/render/probe.ts', 'src/render/asset-urls.ts'];

/** First chain of runtime imports from `entry` that reaches Three.js, if any. */
const threeChain = (entry: string): string[] | undefined =>
  importChain(
    entry,
    ({ specifier }) => THREE.test(specifier),
    () => true,
  );

describe('THREE_FREE_RENDER', () => {
  it.each(THREE_FREE_RENDER)('%s exists and reaches no Three.js at runtime', (entry) => {
    expect(existsSync(join(ROOT, entry))).toBe(true);
    expect(threeChain(entry)).toBeUndefined();
  });

  it('lists every render module imported at runtime from outside render', () => {
    const files = execFileSync('git', ['ls-files', '--', '*.ts', '*.mjs', '*.js'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(
        (path) =>
          path !== '' &&
          !path.startsWith('src/render/') &&
          !path.startsWith('dev/') &&
          !/\.(test|spec)\.ts$/.test(path),
      );
    const used = new Set<string>();
    for (const file of files) {
      for (const { text } of runtimeSpecifiers(file)) {
        if (!text.startsWith('.')) continue;
        const path = resolveRelative(file, text);
        if (path?.startsWith('src/render/')) used.add(path);
      }
    }
    expect(files.length).toBeGreaterThan(0);
    expect(
      [...used].filter(
        (path) => !THREE_FREE_RENDER.includes(path) && !RENDERER_ENTRIES.includes(path),
      ),
    ).toEqual([]);
  });
});
