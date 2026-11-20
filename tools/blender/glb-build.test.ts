import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRAILER_IDS, TRUCK_IDS } from '../../src/contracts/vehicle';
import { MAX_PRECACHE_FILE_BYTES } from '../../src/pwa/config';
import {
  ASSETS,
  canonicalJson,
  glbSceneExtras,
  glbSha256,
  type GlbManifest,
  type Json,
  optimiseSha256,
  ROOT,
  runHashes,
  unsafeNumbers,
} from './glb-build';

const read = (file: string): unknown => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));

/** Helper files a Python script loads with `os.path.join(<dir>, "x.py")`, nested loads included. */
function loadedHelpers(
  entry: string,
  readSource = (file: string): string => readFileSync(join(ROOT, file), 'utf8'),
): string[] {
  const found = new Set<string>();
  const visit = (file: string): void => {
    for (const [, name] of readSource(file).matchAll(/os\.path\.join\(.*,\s*"(\w+\.py)"\)/g)) {
      const helper = join(dirname(file), name ?? '');
      if (!found.has(helper)) {
        found.add(helper);
        visit(helper);
      }
    }
  };
  visit(entry);
  return [...found].sort();
}

/** Red means stale inputs: rerun `pnpm glb:params`, the Blender script, `pnpm glb:optimise`, `pnpm glb:manifest`. */
describe.each(ASSETS)('glb shell build: $key', (asset) => {
  const manifest = read(asset.manifest) as GlbManifest;

  it('commits the params the current vehicle data produces', () => {
    expect(read(asset.params)).toEqual(asset.build());
  });

  it('keeps every param number out of the range where Python and JavaScript print differently', () => {
    expect(unsafeNumbers(asset.build())).toEqual([]);
  });

  it('hashes the scripts, params and glb recorded in the manifest', () => {
    const { blenderVersion, gltfTransformVersion, ...recorded } = manifest;
    expect(blenderVersion).not.toBe('');
    expect(gltfTransformVersion).not.toBe('');
    expect({
      ...runHashes(asset),
      glbSha256: glbSha256(asset),
      glbBytes: statSync(join(ROOT, asset.glb)).size,
    }).toEqual(recorded);
  });

  it('was built and optimised by the current scripts from the current params', () => {
    expect(glbSceneExtras(asset)).toEqual({
      ...runHashes(asset),
      optimiseSha256: optimiseSha256(),
    });
  });

  it('records the hash of every helper file its script loads', () => {
    expect(loadedHelpers(asset.script)).toEqual(Object.values(asset.helpers).sort());
  });

  it('fits the Workbox precache limit', () => {
    expect(manifest.glbBytes).toBeLessThanOrEqual(MAX_PRECACHE_FILE_BYTES);
  });
});

describe('helper load scan', () => {
  it('follows nested loads, whatever the directory expression', () => {
    const sources: Record<string, string> = {
      'd/entry.py':
        'HERE = os.path.dirname(__file__)\nA = runpy.run_path(os.path.join(HERE, "a.py"))',
      'd/a.py': 'B = runpy.run_path(os.path.join(os.path.dirname(__file__), "b.py"))',
      'd/b.py': 'import os',
    };
    expect(loadedHelpers('d/entry.py', (file) => sources[file] ?? '')).toEqual([
      'd/a.py',
      'd/b.py',
    ]);
  });

  it('finds the kernel from lamp_common.py, which loads it without a directory variable', () => {
    expect(loadedHelpers('tools/blender/lamp_common.py')).toEqual([
      'tools/blender/blender_common.py',
    ]);
  });
});

describe('glb shell assets', () => {
  it('give every truck a cab and a body, and every trailer a trailer shell', () => {
    expect(ASSETS.map((a) => a.key).sort()).toEqual(
      [
        ...TRUCK_IDS.flatMap((id) => [`${id}-body`, `${id}-cab`]),
        ...TRAILER_IDS.map((id) => `${id}-trailer`),
      ].sort(),
    );
  });

  it('canonicalises JSON independent of key order', () => {
    const value: Json = { b: [1, { d: 2, c: 3 }], a: null };
    expect(canonicalJson(value)).toBe('{"a":null,"b":[1,{"c":3,"d":2}]}');
  });
});
