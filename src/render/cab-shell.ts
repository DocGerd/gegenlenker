import { type Group, Mesh, MeshLambertMaterial, type Object3D } from 'three';
import type { ScenePalette } from '../contracts/render';
import type { TruckId } from '../contracts/vehicle';
import manLe18280Url from './assets/man-le-18-280-cab.glb?url';
import { AIDS_LAYER, CAB_LAYER } from './seams';

/*
 * The Blender cab shell (tools/blender, issue #68), shown in the mirrors only: the cockpit eye sits
 * inside the cab. The top-down view keeps the procedural token box, moved onto AIDS_LAYER.
 */

const BODY_NAME = 'cab-body';
const DETAIL_NAME = 'cab-detail';

const URLS: Readonly<Partial<Record<TruckId, string>>> = { 'man-le-18-280': manLe18280Url };

/** Mesh prototypes carrying the glTF node transform; visuals share their geometry. */
export type CabShell = {
  readonly body: Mesh;
  readonly detail: Mesh;
};

function find(root: Object3D, name: string): Mesh {
  const found = root.getObjectByName(name);
  if (!(found instanceof Mesh)) throw new Error(`cab shell has no mesh "${name}"`);
  return found as Mesh;
}

export async function parseCabShell(data: ArrayBuffer): Promise<CabShell> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(data, '');
  gltf.scene.updateMatrixWorld(true);
  const shell = { body: find(gltf.scene, BODY_NAME), detail: find(gltf.scene, DETAIL_NAME) };
  if (!shell.detail.geometry.hasAttribute('color')) throw new Error('cab shell has no colours');
  return shell;
}

async function fetchCabShell(url: string): Promise<CabShell> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return parseCabShell(await response.arrayBuffer());
}

export interface CabShells {
  /**
   * Calls `apply` once the truck's shell has loaded, never when it fails or the truck has none;
   * the returned function cancels. Always asynchronous, so a visual is built before it is called.
   */
  onLoaded(truckId: TruckId, apply: (shell: CabShell) => void): () => void;
}

/**
 * Starts every load now; a failure to load or to apply warns and leaves the procedural cab.
 * `onApplied` reports each successful application, for tests and diagnostics.
 */
export function startCabShells(
  load: (url: string) => Promise<CabShell> = fetchCabShell,
  onApplied: (truckId: TruckId) => void = () => undefined,
): CabShells {
  const loads = new Map<TruckId, Promise<CabShell | null>>();
  for (const [id, url] of Object.entries(URLS) as [TruckId, string][]) {
    loads.set(
      id,
      load(url).catch((error: unknown) => {
        console.warn(`Cab shell ${id} failed to load; keeping the procedural cab`, error);
        return null;
      }),
    );
  }
  return {
    onLoaded(truckId, apply) {
      let cancelled = false;
      void loads.get(truckId)?.then((shell) => {
        if (shell === null || cancelled) return;
        try {
          apply(shell);
          onApplied(truckId);
        } catch (error) {
          console.warn(
            `Cab shell ${truckId} could not be applied; keeping the procedural cab`,
            error,
          );
        }
      });
      return () => {
        cancelled = true;
      };
    },
  };
}

function instance(proto: Mesh, material: MeshLambertMaterial): Mesh {
  const mesh = new Mesh(proto.geometry, material);
  proto.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.layers.set(CAB_LAYER);
  return mesh;
}

/**
 * Swaps the procedural cab for the shell in one step: the box stays top-down only, the shell and
 * the lit cab front trade places in the mirrors. Returns what the visual must dispose.
 * Everything that can throw runs before the group is touched.
 */
export function applyCabShell(
  group: Group,
  cabBox: Mesh,
  cabFront: Mesh,
  shell: CabShell,
  palette: ScenePalette,
): { dispose(): void } {
  const materials = [
    new MeshLambertMaterial({ color: palette.cab }),
    new MeshLambertMaterial({ vertexColors: true }),
  ] as const;
  let meshes: Mesh[];
  try {
    meshes = [instance(shell.body, materials[0]), instance(shell.detail, materials[1])];
  } catch (error) {
    materials.forEach((m) => m.dispose());
    throw error;
  }
  cabBox.layers.set(AIDS_LAYER);
  group.remove(cabFront);
  group.add(...meshes);
  return { dispose: () => materials.forEach((m) => m.dispose()) };
}
