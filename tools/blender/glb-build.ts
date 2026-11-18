import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRUCK_IDS, type TruckId } from '../../src/contracts/vehicle';
import { bodyShellParams } from '../../src/render/body-dims';
import { cabShellParams } from '../../src/render/cab-dims';
import { truckById } from '../../src/vehicles/registry';

export const ROOT = join(import.meta.dirname, '../..');

export const COMMON_SCRIPT = 'tools/blender/shell_common.py';
export const OPTIMISE_SCRIPT = 'scripts/glb-optimise.mjs';

export type AssetKind = 'cab' | 'body';

export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type Asset = {
  /** `<truck id>-<kind>`; names the glb and its manifest. */
  readonly key: string;
  readonly truckId: TruckId;
  readonly kind: AssetKind;
  readonly script: string;
  readonly params: string;
  readonly glb: string;
  readonly manifest: string;
  /** What the committed params file must contain. */
  build(): Json;
};

const SCRIPTS: Readonly<Record<AssetKind, string>> = {
  cab: 'tools/blender/cab_shell.py',
  body: 'tools/blender/body_shell.py',
};

const asset = (truckId: TruckId, kind: AssetKind): Asset => {
  const key = `${truckId}-${kind}`;
  return {
    key,
    truckId,
    kind,
    script: SCRIPTS[kind],
    params: `tools/blender/params/${truckId}.${kind}.json`,
    glb: `src/render/assets/${key}.glb`,
    manifest: `src/render/assets/${key}.manifest.json`,
    build: () =>
      kind === 'cab' ? cabShellParams(truckById(truckId)) : bodyShellParams(truckById(truckId)),
  };
};

export const ASSETS: readonly Asset[] = TRUCK_IDS.flatMap((id) => [
  asset(id, 'cab'),
  asset(id, 'body'),
]);

export function assetByKey(key: string): Asset {
  const found = ASSETS.find((a) => a.key === key);
  if (found === undefined) {
    throw new Error(`unknown asset "${key}"; one of ${ASSETS.map((a) => a.key).join(', ')}`);
  }
  return found;
}

export type GlbManifest = {
  readonly scriptSha256: string;
  readonly commonSha256: string;
  readonly paramsSha256: string;
  readonly blenderVersion: string;
  readonly gltfTransformVersion: string;
  readonly glbSha256: string;
  readonly glbBytes: number;
};

export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** Line endings differ per checkout, so scripts are hashed LF-normalised. */
const fileSha256 = (root: string, file: string): string =>
  sha256(readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n'));

export const scriptSha256 = (a: Asset, root = ROOT): string => fileSha256(root, a.script);
export const commonSha256 = (root = ROOT): string => fileSha256(root, COMMON_SCRIPT);
export const optimiseSha256 = (root = ROOT): string => fileSha256(root, OPTIMISE_SCRIPT);

/** Sorted keys, no whitespace: formatting and key order cannot change the hash. */
export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const paramsSha256 = (a: Asset, root = ROOT): string =>
  sha256(canonicalJson(JSON.parse(readFileSync(join(root, a.params), 'utf8')) as Json));

export const glbSha256 = (a: Asset, root = ROOT): string => sha256(readFileSync(join(root, a.glb)));

/** The `extras` of the glb's first scene, where the Blender script and the optimiser record the hashes of their inputs. */
export function glbSceneExtras(a: Asset, root = ROOT): unknown {
  const glb = readFileSync(join(root, a.glb));
  const json = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8');
  const { scenes } = JSON.parse(json) as { scenes: readonly { extras?: unknown }[] };
  return scenes[0]?.extras;
}

/** Python prints 1e-05 where JavaScript prints 0.00001, which would split the params hashes. */
export function unsafeNumbers(value: Json, path = '$'): string[] {
  if (typeof value === 'number') {
    const unsafe = !Number.isFinite(value) || (value !== 0 && Math.abs(value) < 1e-4);
    return unsafe ? [`${path}=${value}`] : [];
  }
  if (Array.isArray(value)) {
    return (value as readonly Json[]).flatMap((v, i) => unsafeNumbers(v, `${path}[${i}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => unsafeNumbers(v, `${path}.${k}`));
  }
  return [];
}
