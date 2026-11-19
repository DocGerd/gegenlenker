import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
  RUNS,
  runHashes,
  unsafeNumbers,
} from './glb-build';

const read = (file: string): unknown => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));

/** Red means stale inputs: rerun `pnpm glb:params`, the Blender script, `pnpm glb:optimise`, `pnpm glb:manifest`. */
describe.each(RUNS)('blender params: $key', (run) => {
  it('commits the params the current data produces', () => {
    expect(read(run.params)).toEqual(run.build());
  });

  it('keeps every param number out of the range where Python and JavaScript print differently', () => {
    expect(unsafeNumbers(run.build())).toEqual([]);
  });
});

describe.each(ASSETS)('glb build: $key', (asset) => {
  const manifest = read(asset.manifest) as GlbManifest;
  const { blenderVersion, gltfTransformVersion, ...recorded } = manifest;

  it('hashes the scripts, params and glb recorded in the manifest', () => {
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

  it('fits the Workbox precache limit', () => {
    expect(manifest.glbBytes).toBeLessThanOrEqual(MAX_PRECACHE_FILE_BYTES);
  });
});

describe('glb shell assets', () => {
  it('give every truck a cab and a body, every trailer a trailer shell, and the yard a kit', () => {
    expect(ASSETS.map((a) => a.key).sort()).toEqual(
      [
        ...TRUCK_IDS.flatMap((id) => [`${id}-body`, `${id}-cab`]),
        ...TRAILER_IDS.map((id) => `${id}-trailer`),
        'yard-kit',
      ].sort(),
    );
  });

  it('canonicalises JSON independent of key order', () => {
    const value: Json = { b: [1, { d: 2, c: 3 }], a: null };
    expect(canonicalJson(value)).toBe('{"a":null,"b":[1,{"c":3,"d":2}]}');
  });
});
