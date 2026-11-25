import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../../src/contracts/vehicle';
import { bodyShellParams } from '../../src/render/body-dims';
import { cabShellParams } from '../../src/render/cab-dims';
import { interiorShellParams } from '../../src/render/interior-dims';
import { bodyLampParams, cabLampParams, trailerLampParams } from '../../src/render/lamp-layout';
import { TRUCK_LOOKS } from '../../src/render/livery';
import { cabMirrorParams } from '../../src/render/mirror-fields';
import { trailerShellParams } from '../../src/render/trailer-dims';
import { trailerById, truckById } from '../../src/vehicles/registry';
import { yardKitParams } from './kit-params';
import { canonicalJson, fileSha256, type Json, ROOT, sha256 } from '../assets/provenance';

export { canonicalJson, type Json, ROOT, sha256 };

export const COMMON_SCRIPT = 'tools/blender/blender_common.py';
export const LAMP_COMMON_SCRIPT = 'tools/blender/lamp_common.py';
export const KIT_COMMON_SCRIPT = 'tools/blender/kit_common.py';
export const OPTIMISE_SCRIPT = 'scripts/glb-optimise.mjs';

export type AssetKind = 'cab' | 'body' | 'trailer' | 'interior' | 'kit';

/** One run of a Blender script on one params file. */
export type Run = {
  readonly key: string;
  readonly script: string;
  readonly params: string;
  /** Helper scripts the entry script loads, by the key it records their hash under. */
  readonly helpers: Readonly<Record<string, string>>;
  /** What the committed params file must contain. */
  build(): Json;
};

export type Asset = Run & {
  /** `<vehicle id>-<kind>` names the glb and its manifest; the kit is `yard-kit`. */
  readonly kind: AssetKind;
  readonly glb: string;
  readonly manifest: string;
};

const SCRIPTS: Readonly<Record<Exclude<AssetKind, 'kit'>, string>> = {
  cab: 'tools/blender/cab_shell.py',
  body: 'tools/blender/body_shell.py',
  trailer: 'tools/blender/trailer_shell.py',
  interior: 'tools/blender/interior_shell.py',
};

const SHELL_HELPERS = { commonSha256: COMMON_SCRIPT, lampCommonSha256: LAMP_COMMON_SCRIPT };
const INTERIOR_HELPERS = { commonSha256: COMMON_SCRIPT };

const asset = (
  vehicleId: TruckId | TrailerId,
  kind: Exclude<AssetKind, 'kit'>,
  build: () => Json,
): Asset => {
  const key = `${vehicleId}-${kind}`;
  return {
    key,
    kind,
    script: SCRIPTS[kind],
    params: `tools/blender/params/${vehicleId}.${kind}.json`,
    helpers: kind === 'interior' ? INTERIOR_HELPERS : SHELL_HELPERS,
    glb: `src/render/assets/${key}.glb`,
    manifest: `src/render/assets/${key}.manifest.json`,
    build,
  };
};

const KIT_HELPERS = { commonSha256: COMMON_SCRIPT, kitCommonSha256: KIT_COMMON_SCRIPT };

const kitRun = (key: string, build: () => Json): Run => ({
  key,
  script: `tools/blender/${key.replaceAll('-', '_')}.py`,
  params: `tools/blender/params/${key}.json`,
  helpers: KIT_HELPERS,
  build,
});

export const YARD_KIT_RUN = kitRun('yard-kit', yardKitParams);

export const ASSETS: readonly Asset[] = [
  ...TRUCK_IDS.flatMap((id) => [
    asset(id, 'cab', () => ({
      ...cabShellParams(truckById(id)),
      ...cabLampParams(truckById(id), TRUCK_LOOKS[id].cab.length),
      ...cabMirrorParams(truckById(id)),
    })),
    asset(id, 'body', () => ({
      ...bodyShellParams(truckById(id)),
      ...bodyLampParams(truckById(id), TRUCK_LOOKS[id].cab.length),
    })),
    asset(id, 'interior', () => interiorShellParams(truckById(id))),
  ]),
  ...TRAILER_IDS.map((id) =>
    asset(id, 'trailer', () => ({
      ...trailerShellParams(trailerById(id)),
      ...trailerLampParams(trailerById(id)),
    })),
  ),
  {
    ...YARD_KIT_RUN,
    kind: 'kit',
    glb: 'src/render/assets/yard-kit.glb',
    manifest: 'src/render/assets/yard-kit.manifest.json',
  },
];

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
  readonly lampCommonSha256?: string;
  readonly kitCommonSha256?: string;
  readonly paramsSha256: string;
  readonly blenderVersion: string;
  readonly gltfTransformVersion: string;
  readonly glbSha256: string;
  readonly glbBytes: number;
};

export const scriptSha256 = (a: Run, root = ROOT): string => fileSha256(root, a.script);
export const optimiseSha256 = (root = ROOT): string => fileSha256(root, OPTIMISE_SCRIPT);

export const paramsSha256 = (a: Run, root = ROOT): string =>
  sha256(canonicalJson(JSON.parse(readFileSync(join(root, a.params), 'utf8')) as Json));

/** The input hashes a run records, in manifest order: script, helpers, params. */
export const runHashes = (a: Run, root = ROOT): Record<string, string> => ({
  scriptSha256: scriptSha256(a, root),
  ...Object.fromEntries(Object.entries(a.helpers).map(([k, file]) => [k, fileSha256(root, file)])),
  paramsSha256: paramsSha256(a, root),
});

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
