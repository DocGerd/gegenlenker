import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRUCK_IDS } from '../../src/contracts/vehicle';
import { MAX_PRECACHE_FILE_BYTES } from '../../src/pwa/config';
import {
  ASSETS,
  canonicalJson,
  commonSha256,
  glbSceneExtras,
  glbSha256,
  type GlbManifest,
  type Json,
  paramsSha256,
  ROOT,
  scriptSha256,
  unsafeNumbers,
} from './glb-build';

const read = (file: string): unknown => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));

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
    expect({
      scriptSha256: scriptSha256(asset),
      commonSha256: commonSha256(),
      paramsSha256: paramsSha256(asset),
      glbSha256: glbSha256(asset),
      glbBytes: statSync(join(ROOT, asset.glb)).size,
    }).toEqual({
      scriptSha256: manifest.scriptSha256,
      commonSha256: manifest.commonSha256,
      paramsSha256: manifest.paramsSha256,
      glbSha256: manifest.glbSha256,
      glbBytes: manifest.glbBytes,
    });
  });

  it('was built from the current scripts and params', () => {
    expect(glbSceneExtras(asset)).toEqual({
      commonSha256: commonSha256(),
      paramsSha256: paramsSha256(asset),
      scriptSha256: scriptSha256(asset),
    });
  });

  it('fits the Workbox precache limit', () => {
    expect(manifest.glbBytes).toBeLessThanOrEqual(MAX_PRECACHE_FILE_BYTES);
  });
});

describe('glb shell assets', () => {
  it('give every truck a cab and a body', () => {
    expect(ASSETS.map((a) => a.key).sort()).toEqual(
      TRUCK_IDS.flatMap((id) => [`${id}-body`, `${id}-cab`]).sort(),
    );
  });

  it('canonicalises JSON independent of key order', () => {
    const value: Json = { b: [1, { d: 2, c: 3 }], a: null };
    expect(canonicalJson(value)).toBe('{"a":null,"b":[1,{"c":3,"d":2}]}');
  });
});
