import { Group, type Material, Mesh, MeshBasicMaterial } from 'three';
import type { ScenePalette } from '../contracts/render';
import type { TruckId, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { createCockpitInterior, type FlatInterior } from './cockpit-interior';
import arocsUrl from './assets/arocs-1835-ak-interior.glb?url';
import manUrl from './assets/man-le-18-280-interior.glb?url';
import type { InteriorMeshName } from './interior-dims';
import {
  type InteriorCheck,
  InteriorNodeMaterial,
  type InteriorVerdict,
} from './interior-material';
import type { Look } from './look';
import { INTERIOR_LAYER, type CockpitInterior } from './seams';
import type { Shells } from './glb-shells';
import { setGraded } from './grade';
import type { VehicleEnvironment } from './vehicle-pbr';

/*
 * The cab interior as a Blender asset (tools/blender/interior_shell.py, #159): the dashboard with its
 * binnacle, the door tops, the A-pillars at the windscreen's corners, the header band with the roof
 * lining and the stowed visor, and the steering wheel, all in the truck's frame. They are depth
 * tested, so each hides what lies behind it. Where the preset lights the perspective views they wear
 * the lit material and take the sun's shadow; elsewhere they stay unlit. Until the asset is in place,
 * and wherever the preset does not draw it, the flat overlay shows.
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
  /** The sky the lit material reflects, with the palette it is made for. */
  readonly env?: VehicleEnvironment;
  readonly palette?: ScenePalette;
  /**
   * Whether the lit shader compiles with that map on the live renderer; the plain material stays until
   * it does, and for good where it fails. Without one, a ready map is trusted.
   */
  readonly check?: InteriorCheck;
};

export type GlbInterior = CockpitInterior & {
  readonly flat: FlatInterior;
  /** The parts drawn when the asset shows. */
  readonly meshes: readonly Mesh[];
  /** Whether the asset, not the flat overlay, is what shows now. */
  readonly drawn: boolean;
  /** The material the parts wear now: lit under perspective lighting, plain vertex colours otherwise. */
  readonly material: Material;
  attach(shell: InteriorShell): void;
  detach(): void;
};

export function createGlbInterior(
  truck: TruckSpec,
  { shells, env, palette, check }: InteriorOptions = {},
): GlbInterior {
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

  const plain = new MeshBasicMaterial({ vertexColors: true, fog: false });
  let lit: InteriorNodeMaterial | null = null;
  let look: Look | null = null;
  const meshes: Mesh[] = [];
  let attached = false;
  let wanted = false;
  let drawn = false;

  let useLit = false;
  const current = (): Material => (useLit ? litMaterial() : plain);
  const litMaterial = (): InteriorNodeMaterial => (lit ??= new InteriorNodeMaterial());

  /**
   * Lit and sun-shadowed under perspective lighting once the sky map is ready and its program has
   * built the lit shader; plain until then and wherever that fails, which leaves the grade and the sun
   * to the rest. A map of a program not checked yet leaves a lit interior lit, without a map, until
   * the check settles.
   */
  const dress = (): void => {
    if (look === null) return;
    plain.color.setRGB(...look.interior.unlit);
    const on = look.flags.perspectiveLighting;
    const map = on && palette !== undefined ? (env?.texture(palette, look.mode) ?? null) : null;
    const verdict: InteriorVerdict =
      map === null ? (env === undefined ? 'ok' : 'pending') : (check?.verdict(map) ?? 'ok');
    const lightable = on && (env === undefined || map !== null);
    useLit = lightable && (verdict === 'ok' || (verdict === 'pending' && useLit));
    if (useLit) {
      const material = litMaterial();
      setGraded(material, look.grade.on);
      material.envMap = verdict === 'ok' ? map : null;
    }
    for (const mesh of meshes) {
      mesh.material = current();
      mesh.receiveShadow = useLit && look.flags.sunShadow;
    }
  };

  const place = (proto: Mesh): Mesh => {
    const mesh = new Mesh(proto.geometry, current());
    proto.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.name = proto.name;
    mesh.layers.set(INTERIOR_LAYER);
    mesh.castShadow = false;
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

  const apply = (): void => {
    if (look === null) return;
    flat.setLook(look);
    wanted = look.flags.cockpitInterior && look.flags.interiorGlb;
    dress();
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
  const stopEnv = env?.onChange(dress);
  const stopCheck = check?.onChange(dress);

  return {
    object,
    frame: 'eye',
    flat,
    meshes,
    get drawn() {
      return drawn;
    },
    get material() {
      return current();
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
    setLook(next) {
      look = next;
      apply();
    },
    dispose() {
      cancel?.();
      stopEnv?.();
      stopCheck?.();
      if (drawn) shells?.attached(key, false);
      drawn = false;
      flat.dispose();
      plain.dispose();
      lit?.dispose();
    },
  };
}
