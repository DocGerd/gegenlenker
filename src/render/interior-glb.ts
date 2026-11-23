import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Uint32BufferAttribute,
} from 'three';
import type { ScenePalette } from '../contracts/render';
import type { TruckId, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import {
  createBinnacleLip,
  createCockpitInterior,
  type FlatInterior,
  placeInEye,
} from './cockpit-interior';
import arocsUrl from './assets/arocs-1835-ak-interior.glb?url';
import manUrl from './assets/man-le-18-280-interior.glb?url';
import { COCKPIT_PITCH } from './cockpit-camera';
import type { InteriorMeshName } from './interior-dims';
import {
  type InteriorCheck,
  InteriorNodeMaterial,
  type InteriorVerdict,
} from './interior-material';
import type { Look } from './look';
import { INTERIOR_LAYER, type CockpitInterior } from './seams';
import { bakeGeometry, type Shells } from './glb-shells';
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

/** One source mesh's slice of the merged geometry: its vertices, and its triangles in the index. */
export type InteriorPartRange = {
  readonly name: InteriorMeshName;
  readonly vertexStart: number;
  readonly vertexCount: number;
  readonly indexStart: number;
  readonly indexCount: number;
};

/** The merged geometry of a shell with each part's range, baked once per shell. */
type Merged = { readonly geometry: BufferGeometry; readonly ranges: readonly InteriorPartRange[] };

const merges = new WeakMap<InteriorShell, Merged>();
const rangesOf = new WeakMap<BufferGeometry, readonly InteriorPartRange[]>();

/** The four meshes as one geometry in the frame of the shell's node matrices; they share a material and never move apart. */
function mergedGeometry(shell: InteriorShell): Merged {
  const cached = merges.get(shell);
  if (cached !== undefined) return cached;
  const parts = NAMES.map((name) => {
    const mesh = shell[name];
    mesh.updateWorldMatrix(true, false);
    return { name, geometry: mesh.geometry, matrix: mesh.matrixWorld };
  });
  const geometry = bakeGeometry(parts);
  const ranges: InteriorPartRange[] = [];
  let vertexStart = 0;
  let indexStart = 0;
  for (const { name, geometry: part } of parts) {
    const vertexCount = part.getAttribute('position').count;
    const indexCount = part.index?.count ?? vertexCount;
    ranges.push({ name, vertexStart, vertexCount, indexStart, indexCount });
    vertexStart += vertexCount;
    indexStart += indexCount;
  }
  const merged = { geometry, ranges };
  merges.set(shell, merged);
  rangesOf.set(geometry, ranges);
  return merged;
}

const views = new WeakMap<BufferGeometry, readonly BufferGeometry[]>();

/**
 * The merged mesh as one mesh per source part, for checks by part (not for drawing): same material, layers,
 * visibility and world matrix as `mesh` now, each with only its own vertices.
 */
export function interiorParts(mesh: Mesh): Mesh[] {
  const ranges = rangesOf.get(mesh.geometry);
  if (ranges === undefined) return [mesh];
  let geometries = views.get(mesh.geometry);
  if (geometries === undefined) {
    const { geometry } = mesh;
    const index = geometry.getIndex();
    if (index === null) throw new Error('a merged interior has an index');
    geometries = ranges.map((r) => {
      const slice = (name: string, size: number): Float32BufferAttribute =>
        new Float32BufferAttribute(
          (geometry.getAttribute(name).array as Float32Array).slice(
            r.vertexStart * size,
            (r.vertexStart + r.vertexCount) * size,
          ),
          size,
        );
      const own = new Uint32Array(r.indexCount);
      for (let i = 0; i < r.indexCount; i++) own[i] = index.getX(r.indexStart + i) - r.vertexStart;
      return new BufferGeometry()
        .setAttribute('position', slice('position', 3))
        .setAttribute('normal', slice('normal', 3))
        .setAttribute('color', slice('color', 3))
        .setIndex(new Uint32BufferAttribute(own, 1));
    });
    views.set(geometry, geometries);
  }
  return ranges.map((r, i) => {
    const part = new Mesh(geometries[i], mesh.material);
    part.name = r.name;
    part.layers.mask = mesh.layers.mask;
    part.visible = mesh.visible;
    part.castShadow = mesh.castShadow;
    part.receiveShadow = mesh.receiveShadow;
    part.matrixAutoUpdate = false;
    part.matrixWorldAutoUpdate = false;
    part.matrixWorld.copy(mesh.matrixWorld);
    return part;
  });
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
  /** What is drawn when the asset shows: the four parts merged into one mesh (`interiorParts` splits it). */
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
  // Placed at the camera's eye with the truck's heading each frame: it stays put while the head turns.
  const standing = new Group();
  standing.name = 'interior-standing';
  // The meshes are authored in the body frame about the origin; the eye is the anchor.
  const frame = new Group();
  frame.position.set(-eye.x, -eye.z, eye.y);
  standing.add(frame);
  // the lit lip is authored in the camera's NDC like the flat overlay, so it has its own frame, facing
  // where the head looks forward
  const lip = createBinnacleLip();
  const lipFrame = new Group();
  lipFrame.name = 'binnacle-lip-frame';
  lipFrame.add(lip.mesh);
  lipFrame.visible = false;
  object.add(flat.object, standing, lipFrame);
  standing.visible = false;

  const plain = new MeshBasicMaterial({ vertexColors: true, fog: false });
  let lit: InteriorNodeMaterial | null = null;
  let look: Look | null = null;
  const meshes: Mesh[] = [];
  let attached = false;
  let wanted = false;
  let drawn = false;
  const forward = new Quaternion();
  const forwardEuler = new Euler(0, 0, 0, 'YXZ');

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

  const place = (shell: InteriorShell): Mesh => {
    const mesh = new Mesh(mergedGeometry(shell).geometry, current());
    mesh.name = 'interior-merged';
    mesh.layers.set(INTERIOR_LAYER);
    mesh.castShadow = false;
    meshes.push(mesh);
    return mesh;
  };

  const sync = (): void => {
    const next = wanted && attached;
    flat.object.visible = flat.object.visible && !next;
    standing.visible = next;
    lipFrame.visible = next;
    if (next !== drawn) {
      drawn = next;
      shells?.attached(key, next);
    }
  };

  const apply = (): void => {
    if (look === null) return;
    flat.setLook(look);
    lip.setLook(look);
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
    frame.add(place(shell));
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
    get looksAround() {
      return drawn;
    },
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
      const { camera, heading } = view;
      standing.position.copy(camera.position);
      standing.rotation.set(0, heading, 0);
      standing.updateMatrixWorld(true);
      forward.setFromEuler(forwardEuler.set(COCKPIT_PITCH, heading - Math.PI / 2, 0));
      placeInEye(lipFrame, camera, forward);
      lipFrame.updateMatrixWorld(true);
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
      lip.dispose();
      plain.dispose();
      lit?.dispose();
    },
  };
}
