import { type Group, Mesh, MeshLambertMaterial, type Object3D } from 'three';
import arocsBodyUrl from './assets/arocs-1835-ak-body.glb?url';
import arocsCabUrl from './assets/arocs-1835-ak-cab.glb?url';
import manBodyUrl from './assets/man-le-18-280-body.glb?url';
import manCabUrl from './assets/man-le-18-280-cab.glb?url';
import { AIDS_LAYER } from './seams';

/*
 * Blender shells (tools/blender, issues #68 and #133): one vertex-coloured mesh per rigid group,
 * shown in the perspective views only. The top-down view keeps the procedural token meshes, moved
 * onto AIDS_LAYER while a shell is in place. Colours are linear in the glb, like `tint()`.
 */

/** `<truck id>-cab` and `<truck id>-body`; the keys of the asset list in tools/blender/glb-build.ts. */
export const CAB_SHELL_URLS: Readonly<Record<string, string>> = {
  'arocs-1835-ak-cab': arocsCabUrl,
  'man-le-18-280-cab': manCabUrl,
};
export const BODY_SHELL_URLS: Readonly<Record<string, string>> = {
  'arocs-1835-ak-body': arocsBodyUrl,
  'man-le-18-280-body': manBodyUrl,
};

/** The mesh prototype carrying the glTF node transform; visuals share its geometry. */
export type Shell = { readonly mesh: Mesh };

export async function parseShell(data: ArrayBuffer): Promise<Shell> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(data, '');
  gltf.scene.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  gltf.scene.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o as Mesh);
  });
  const [mesh] = meshes;
  if (mesh === undefined || meshes.length !== 1) {
    throw new Error(`shell has ${meshes.length} meshes, expected one`);
  }
  if (!mesh.geometry.hasAttribute('color')) throw new Error('shell has no colours');
  return { mesh };
}

async function fetchShell(url: string): Promise<Shell> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return parseShell(await response.arrayBuffer());
}

export interface Shells {
  /**
   * Calls `apply` once the shell has loaded, never when it fails or `key` has none; the returned
   * function cancels. Always asynchronous, so a visual is built before it is called.
   * `apply` returns whether the shell now sits on the vehicle.
   */
  onLoaded(key: string, apply: (shell: Shell) => boolean): () => void;
  /** Starts the loads on the first call with `true`; nothing is downloaded before. */
  setEnabled(on: boolean): void;
}

export type TruckShells = { readonly cab: Shells; readonly body: Shells };

/**
 * Starts every load once enabled; a failure to load or to apply warns and leaves the procedural
 * mesh. `onApplied` reports each shell that ends up on a vehicle, for tests and diagnostics.
 */
export function startShells(
  urls: Readonly<Record<string, string>>,
  {
    load = fetchShell,
    onApplied = () => undefined,
    enabled = true,
  }: {
    load?: (url: string) => Promise<Shell>;
    onApplied?: (key: string) => void;
    enabled?: boolean;
  } = {},
): Shells {
  let start = (): void => undefined;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  if (enabled) start();
  const loads = new Map<string, Promise<Shell | null>>();
  for (const [key, url] of Object.entries(urls)) {
    loads.set(
      key,
      started
        .then(() => load(url))
        .catch((error: unknown) => {
          console.warn(`Shell ${key} failed to load; keeping the procedural mesh`, error);
          return null;
        }),
    );
  }
  return {
    setEnabled(on) {
      if (on) start();
    },
    onLoaded(key, apply) {
      let cancelled = false;
      void loads.get(key)?.then((shell) => {
        if (shell === null || cancelled) return;
        try {
          if (apply(shell)) onApplied(key);
        } catch (error) {
          console.warn(`Shell ${key} could not be applied; keeping the procedural mesh`, error);
        }
      });
      return () => {
        cancelled = true;
      };
    },
  };
}

const homes = new WeakMap<Object3D, Map<Object3D, number>>();

/** Each child's first index, remembered per group so a swap that starts later still restores the original order. */
function homeOrder(group: Group): Map<Object3D, number> {
  let order = homes.get(group);
  if (order === undefined) {
    order = new Map();
    homes.set(group, order);
  }
  for (const child of group.children) if (!order.has(child)) order.set(child, order.size);
  return order;
}

export type ShellSwap = {
  /** Procedural meshes that stay for the top-down view only while the shell shows. */
  readonly toAids: readonly Mesh[];
  /** Procedural meshes taken out of the group while the shell shows. */
  readonly remove: readonly Object3D[];
  /** Procedural stand-ins that join the shell while it shows. */
  readonly add?: readonly Mesh[];
  readonly layer: number;
};

/**
 * Swaps procedural meshes for a shell in one step and back again, restoring layers and child order.
 * Returns what the visual must dispose. Everything that can throw runs before the group is touched.
 */
export function applyShell(
  group: Group,
  shell: Shell,
  swap: ShellSwap,
  enabled = true,
): { dispose(): void; setEnabled(on: boolean): void } {
  const material = new MeshLambertMaterial({ vertexColors: true });
  let mesh: Mesh;
  try {
    mesh = new Mesh(shell.mesh.geometry, material);
    shell.mesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.layers.set(swap.layer);
  } catch (error) {
    material.dispose();
    throw error;
  }
  const added = [mesh, ...(swap.add ?? [])];
  const masks = swap.toAids.map((m) => m.layers.mask);
  const order = homeOrder(group);
  const rank = (o: Object3D): number => order.get(o) ?? Number.MAX_SAFE_INTEGER;
  let on = false;
  const setEnabled = (next: boolean): void => {
    if (next === on) return;
    on = next;
    if (next) {
      swap.toAids.forEach((m) => m.layers.set(AIDS_LAYER));
      group.remove(...swap.remove);
      group.add(...added);
    } else {
      swap.toAids.forEach((m, i) => (m.layers.mask = masks[i] ?? m.layers.mask));
      group.remove(...added);
      group.add(...swap.remove);
      group.children.sort((a, b) => rank(a) - rank(b));
    }
  };
  setEnabled(enabled);
  return { dispose: () => material.dispose(), setEnabled };
}
