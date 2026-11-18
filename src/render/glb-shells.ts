import { type Group, type Material, Mesh, type Object3D } from 'three';
import type { TrailerId, TruckId } from '../contracts/vehicle';
import hueffermannUrl from './assets/hueffermann-hpa-24-81-l-trailer.glb?url';
import kroneUrl from './assets/krone-azw-18-trailer.glb?url';
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

export type ShellKind = 'cab' | 'body';

/** `<truck id>-<kind>`: the keys of the asset list in tools/blender/glb-build.ts. */
export const CAB_SHELL_URLS = {
  'arocs-1835-ak-cab': arocsCabUrl,
  'man-le-18-280-cab': manCabUrl,
} as const satisfies Record<`${TruckId}-cab`, string>;
export const BODY_SHELL_URLS = {
  'arocs-1835-ak-body': arocsBodyUrl,
  'man-le-18-280-body': manBodyUrl,
} as const satisfies Record<`${TruckId}-body`, string>;

export const TRAILER_SHELL_URLS = {
  'hueffermann-hpa-24-81-l-trailer': hueffermannUrl,
  'krone-azw-18-trailer': kroneUrl,
} as const satisfies Record<`${TrailerId}-trailer`, string>;

/** The mesh prototype carrying the glTF node transform; visuals share its geometry. */
export type Shell = { readonly mesh: Mesh };

/** A trailer asset holds two rigid groups: the body, and the dolly with its drawbar. */
export type TrailerShell = { readonly trailer: Shell; readonly dolly: Shell };

async function parseMeshes(data: ArrayBuffer): Promise<Mesh[]> {
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
  for (const mesh of meshes) {
    if (!mesh.geometry.hasAttribute('color'))
      throw new Error(`shell "${mesh.name}" has no colours`);
  }
  return meshes;
}

/** Decodes one shell; `kind` is the node name the Blender script gives it, so a swapped URL fails. */
export async function parseShell(data: ArrayBuffer, kind: ShellKind): Promise<Shell> {
  const meshes = await parseMeshes(data);
  const [mesh] = meshes;
  if (mesh === undefined || meshes.length !== 1) {
    throw new Error(`shell has ${meshes.length} meshes, expected one`);
  }
  if (mesh.name !== kind) throw new Error(`shell is "${mesh.name}", expected "${kind}"`);
  return { mesh };
}

/** Decodes a trailer asset: exactly the meshes `trailer` and `dolly`. */
export async function parseTrailerShell(data: ArrayBuffer): Promise<TrailerShell> {
  const meshes = await parseMeshes(data);
  const names = meshes.map((m) => m.name).sort();
  if (names.join() !== 'dolly,trailer') {
    throw new Error(`trailer shell has meshes [${names.join(', ')}], expected [dolly, trailer]`);
  }
  const find = (name: string): Shell => {
    const mesh = meshes.find((m) => m.name === name);
    if (mesh === undefined) throw new Error(`trailer shell lacks "${name}"`);
    return { mesh };
  };
  return { trailer: find('trailer'), dolly: find('dolly') };
}

async function fetchData(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}

async function fetchShell(url: string, key: string): Promise<Shell> {
  return parseShell(await fetchData(url), key.endsWith('-cab') ? 'cab' : 'body');
}

export const fetchTrailerShell = async (url: string): Promise<TrailerShell> =>
  parseTrailerShell(await fetchData(url));

export interface Shells<S = Shell> {
  /**
   * Calls `apply` once the shell has loaded, never when it fails or `key` has none (that warns);
   * the returned function cancels. Always asynchronous, so a visual is built before it is called.
   */
  onLoaded(key: string, apply: (shell: S) => void): () => void;
  /** A visual reports that the shell of `key` now sits on it, or no longer does. */
  attached(key: string, on: boolean): void;
  /** Starts the loads on the first call with `true`, and retries the ones that failed. */
  setEnabled(on: boolean): void;
}

export type TruckShells = { readonly cab: Shells; readonly body: Shells };

type StartOptions<S> = {
  load?: (url: string, key: string) => Promise<S>;
  onAttached?: (key: string, attached: boolean) => void;
  enabled?: boolean;
};

/**
 * Loads every shell once enabled; a failure to load or to apply warns and leaves the procedural
 * mesh, and the next enable retries the load. `onAttached` reports a shell when its first visual
 * takes it and again when the last visual lets go, for tests and diagnostics.
 */
export function startShells(
  urls: Readonly<Record<string, string>>,
  options?: StartOptions<Shell>,
): Shells;
export function startShells<S>(
  urls: Readonly<Record<string, string>>,
  options: StartOptions<S> & { readonly load: (url: string, key: string) => Promise<S> },
): Shells<S>;
export function startShells<S>(
  urls: Readonly<Record<string, string>>,
  {
    load = fetchShell as unknown as (url: string, key: string) => Promise<S>,
    onAttached = () => undefined,
    enabled = true,
  }: StartOptions<S> = {},
): Shells<S> {
  type Waiter = { readonly key: string; readonly apply: (shell: S) => void };
  const loaded = new Map<string, S>();
  const loading = new Set<string>();
  const waiting = new Set<Waiter>();
  const users = new Map<string, number>();
  let on = enabled;

  const deliver = (key: string, shell: S): void => {
    for (const waiter of [...waiting].filter((w) => w.key === key)) {
      waiting.delete(waiter);
      try {
        waiter.apply(shell);
      } catch (error) {
        console.warn(`Shell ${key} could not be applied; keeping the procedural mesh`, error);
      }
    }
  };
  const request = (key: string, url: string): void => {
    if (!on || loading.has(key) || loaded.has(key)) return;
    loading.add(key);
    Promise.resolve()
      .then(() => load(url, key))
      .then(
        (shell) => {
          loaded.set(key, shell);
          deliver(key, shell);
        },
        (error: unknown) => {
          console.warn(`Shell ${key} failed to load; keeping the procedural mesh`, error);
        },
      )
      .finally(() => loading.delete(key));
  };
  const requestAll = (): void => {
    for (const [key, url] of Object.entries(urls)) request(key, url);
  };
  requestAll();

  return {
    setEnabled(next) {
      if (!next) return;
      on = true;
      requestAll();
    },
    attached(key, isOn) {
      const before = users.get(key) ?? 0;
      const after = Math.max(0, before + (isOn ? 1 : -1));
      users.set(key, after);
      if (isOn ? before === 0 : before === 1) onAttached(key, isOn);
    },
    onLoaded(key, apply) {
      const url = Object.hasOwn(urls, key) ? urls[key] : undefined;
      if (url === undefined) {
        console.warn(`Shell ${key} has no URL; keeping the procedural mesh`);
        return () => undefined;
      }
      const waiter: Waiter = { key, apply };
      waiting.add(waiter);
      const shell = loaded.get(key);
      if (shell === undefined) request(key, url);
      else {
        void Promise.resolve().then(() => {
          if (waiting.has(waiter)) deliver(key, shell);
        });
      }
      return () => {
        waiting.delete(waiter);
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

export type ShellOptions = {
  /** The visual's own detail material, shared with its procedural detail; the caller disposes it. */
  readonly material: Material;
  readonly enabled?: boolean;
  /** Called with the new state each time the shell attaches to or detaches from the group. */
  readonly onChange?: (attached: boolean) => void;
};

/**
 * Swaps procedural meshes for a shell in one step and back again, restoring layers and child order.
 * Everything that can throw runs under one guard that leaves the group as it was.
 */
export function applyShell(
  group: Group,
  shell: Shell,
  swap: ShellSwap,
  { material, enabled = true, onChange = () => undefined }: ShellOptions,
): { dispose(): void; setEnabled(on: boolean): void } {
  const masks = swap.toAids.map((m) => m.layers.mask);
  const order = homeOrder(group);
  const rank = (o: Object3D): number => order.get(o) ?? Number.MAX_SAFE_INTEGER;
  let added: Mesh[] = [];
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
      // add() with no argument logs a three.js error
      if (swap.remove.length > 0) group.add(...swap.remove);
      group.children.sort((a, b) => rank(a) - rank(b));
    }
    onChange(next);
  };
  try {
    const mesh = new Mesh(shell.mesh.geometry, material);
    shell.mesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.layers.set(swap.layer);
    added = [mesh, ...(swap.add ?? [])];
    setEnabled(enabled);
  } catch (error) {
    setEnabled(false);
    throw error;
  }
  return { dispose: () => setEnabled(false), setEnabled };
}
