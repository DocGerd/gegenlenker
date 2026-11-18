import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_PRECACHE_FILE_BYTES } from '../../src/pwa/config';
import { cabShellParams } from '../../src/render/cab-dims';
import { truckById } from '../../src/vehicles/registry';
import {
  CAB_FILES,
  type CabManifest,
  canonicalJson,
  glbSceneExtras,
  glbSha256,
  paramsSha256,
  ROOT,
  scriptSha256,
} from './cab-build';

const read = (file: string): unknown => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
const manifest = read(CAB_FILES.manifest) as CabManifest;

/** Red means stale inputs: rerun `pnpm cab:params`, the Blender script, `pnpm cab:optimise`, `pnpm cab:manifest`. */
describe('cab shell build', () => {
  it('commits the params the current vehicle data produces', () => {
    expect(read(CAB_FILES.params)).toEqual(cabShellParams(truckById('man-le-18-280')));
  });

  it('hashes the script, params and glb recorded in the manifest', () => {
    expect({
      scriptSha256: scriptSha256(),
      paramsSha256: paramsSha256(),
      glbSha256: glbSha256(),
      glbBytes: statSync(join(ROOT, CAB_FILES.glb)).size,
    }).toEqual({
      scriptSha256: manifest.scriptSha256,
      paramsSha256: manifest.paramsSha256,
      glbSha256: manifest.glbSha256,
      glbBytes: manifest.glbBytes,
    });
  });

  it('was built from the current script and params', () => {
    expect(glbSceneExtras()).toEqual({
      scriptSha256: scriptSha256(),
      paramsSha256: paramsSha256(),
    });
  });

  it('fits the Workbox precache limit', () => {
    expect(manifest.glbBytes).toBeLessThanOrEqual(MAX_PRECACHE_FILE_BYTES);
  });

  it('canonicalises JSON independent of key order', () => {
    expect(canonicalJson({ b: [1, { d: 2, c: 3 }], a: null })).toBe(
      '{"a":null,"b":[1,{"c":3,"d":2}]}',
    );
  });
});
