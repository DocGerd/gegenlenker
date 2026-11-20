import { Group, Mesh, MeshBasicMaterial } from 'three';
import type { TruckId, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { createCockpitInterior, type FlatInterior } from './cockpit-interior';
import arocsUrl from './assets/arocs-1835-ak-interior.glb?url';
import manUrl from './assets/man-le-18-280-interior.glb?url';
import type { InteriorMeshName } from './interior-dims';
import { INTERIOR_LAYER, type CockpitInterior } from './seams';
import type { Shells } from './glb-shells';

/*
 * The cab interior as a Blender asset (tools/blender/interior_shell.py, #159): the dashboard with its
 * binnacle, the door tops, the A-pillars at the windscreen's corners, the header band with the roof
 * lining and the stowed visor, and the steering wheel, all in the truck's frame and unlit. They are
 * depth tested, so each hides what lies behind it. Until the asset is in place, and wherever the preset
 * does not draw it, the flat overlay shows.
 */

/** `<truck id>-interior`: the keys of the asset list in tools/blender/glb-build.ts. */
export const INTERIOR_URLS = {
  'arocs-1835-ak-interior': arocsUrl,
  'man-le-18-280-interior': manUrl,
} as const satisfies Record<`${TruckId}-interior`, string>;

/** Mesh prototypes carrying the glTF node transforms; visuals share their geometry. */
export type InteriorShell = Readonly<Record<InteriorMeshName, Mesh>>;

const NAMES: readonly InteriorMeshName[] = ['interior', 'wheel', 'header', 'pillars'];

/** The interior's meshes among decoded ones; any other set is refused. */
export function interiorShellFrom(meshes: readonly Mesh[]): InteriorShell {
  const names = meshes.map((m) => m.name).sort();
  if (names.join() !== [...NAMES].sort().join()) {
    throw new Error(
      `interior has meshes [${names.join(', ')}], expected [${[...NAMES].sort().join(', ')}]`,
    );
  }
  const byName = (name: InteriorMeshName): Mesh => meshes.find((m) => m.name === name) as Mesh;
  return {
    interior: byName('interior'),
    wheel: byName('wheel'),
    header: byName('header'),
    pillars: byName('pillars'),
  };
}

export type InteriorOptions = {
  /** Where the asset comes from; none keeps the flat overlay. */
  readonly shells?: Shells<InteriorShell>;
};

export type GlbInterior = CockpitInterior & {
  readonly flat: FlatInterior;
  /** The parts drawn when the asset shows. */
  readonly meshes: readonly Mesh[];
  /** Whether the asset, not the flat overlay, is what shows now. */
  readonly drawn: boolean;
  attach(shell: InteriorShell): void;
  detach(): void;
};

export function createGlbInterior(truck: TruckSpec, { shells }: InteriorOptions = {}): GlbInterior {
  const flat = createCockpitInterior(truck);
  const key = `${truck.id}-interior`;
  const { eye } = truckAnchors(truck);
  const object = new Group();
  object.name = 'cockpit-interior-glb';
  // Placed at the camera's eye with the truck's heading each frame.
  const standing = new Group();
  standing.name = 'interior-standing';
  // The meshes are authored in the body frame about the origin; the eye is the anchor.
  const frame = new Group();
  frame.position.set(-eye.x, -eye.z, eye.y);
  standing.add(frame);
  object.add(flat.object, standing);
  standing.visible = false;

  const material = new MeshBasicMaterial({ vertexColors: true, fog: false });
  const meshes: Mesh[] = [];
  let attached = false;
  let wanted = false;
  let drawn = false;

  const place = (proto: Mesh): Mesh => {
    const mesh = new Mesh(proto.geometry, material);
    proto.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.name = proto.name;
    mesh.layers.set(INTERIOR_LAYER);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    meshes.push(mesh);
    return mesh;
  };

  const sync = (): void => {
    const next = wanted && attached;
    flat.object.visible = flat.object.visible && !next;
    standing.visible = next;
    if (next !== drawn) {
      drawn = next;
      shells?.attached(key, next);
    }
  };

  let lastFlags: Parameters<CockpitInterior['setQuality']>[0] | null = null;
  const apply = (): void => {
    if (lastFlags === null) return;
    flat.setQuality(lastFlags);
    wanted = lastFlags.cockpitInterior && lastFlags.interiorGlb;
    sync();
  };

  const clear = (): void => {
    frame.clear();
    meshes.length = 0;
  };

  const attach = (shell: InteriorShell): void => {
    clear();
    frame.add(place(shell.interior), place(shell.wheel), place(shell.header), place(shell.pillars));
    attached = true;
    apply();
  };
  const detach = (): void => {
    attached = false;
    clear();
    apply();
  };
  const cancel = shells?.onLoaded(key, attach);

  return {
    object,
    frame: 'eye',
    flat,
    meshes,
    get drawn() {
      return drawn;
    },
    attach,
    detach,
    place(view) {
      if (flat.object.visible) flat.place(view);
      if (!drawn) return;
      const { camera } = view;
      standing.position.copy(camera.position);
      standing.rotation.set(0, camera.rotation.y + Math.PI / 2, 0);
      standing.updateMatrixWorld(true);
    },
    setQuality(flags) {
      lastFlags = flags;
      apply();
    },
    dispose() {
      cancel?.();
      if (drawn) shells?.attached(key, false);
      drawn = false;
      flat.dispose();
      material.dispose();
    },
  };
}
