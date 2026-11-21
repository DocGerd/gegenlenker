import { type BufferGeometry, Color, Float32BufferAttribute, type Matrix4, Vector3 } from 'three';
import { attribute, uniformArray } from 'three/tsl';
import { MeshLambertNodeMaterial, type Node } from 'three/webgpu';
import type { Shell } from './glb-shells';
import { type Lamp, LAMP_COLOURS, type LampColour, type LampFn } from './lamp-layout';
import { type LampState, lensLevel } from './lamp-state';

/*
 * Switchable lamp lenses. Every vertex of the vehicle detail and the shells carries a `lampSlot`:
 * a lens's slot picks its emission from a uniform array, everything else the dark slot. Lamps
 * switch by that uniform only, so no material, light or shader changes while driving.
 */

/** Every function combination a lens carries (lamp-layout.ts), in slot order after the dark slot. */
export const LENS_SLOTS = [
  ['dipped-beam'],
  ['front-position'],
  ['front-indicator'],
  ['side-indicator'],
  ['side-marker'],
  ['end-outline-front'],
  ['end-outline-rear'],
  ['rear-position', 'stop'],
  ['rear-indicator'],
  ['reversing'],
  ['rear-fog'],
  ['rear-plate'],
] as const satisfies readonly (readonly LampFn[])[];

export const SLOT_ATTRIBUTE = 'lampSlot';

/** The slot of everything that is not a lens; it never lights, and three reads a missing attribute as 0. */
export const DARK_SLOT = 0;

/** A lens's slot: one past its index in `LENS_SLOTS`. */
export function slotOf(fns: readonly LampFn[]): number {
  const key = fns.join('+');
  const index = LENS_SLOTS.findIndex((s) => s.join('+') === key);
  if (index < 0) throw new Error(`no lens slot for ${key}`);
  return index + 1;
}

/** Lit colour of each R48 colour, sRGB. */
const EMISSION: Readonly<Record<LampColour, number>> = {
  white: 0xfff6e8,
  red: 0xff1408,
  amber: 0xff9000,
};

/** Gives every vertex of `geometry` one slot. */
export function withSlot(geometry: BufferGeometry, slot = DARK_SLOT): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    SLOT_ATTRIBUTE,
    new Float32BufferAttribute(new Float32Array(count).fill(slot), 1),
  );
  return geometry;
}

/**
 * A copy of a shell's lens geometry, one slot per triangle. `matrix` (the glTF node's) places it, which
 * undoes the optimiser's quantisation. A point just inside each triangle, against its normal, must
 * lie in the box of exactly one of `lamps` within `tolerance`: on a face two lenses share, that picks
 * the lens the face belongs to.
 */
export function tagShellLenses(
  geometry: BufferGeometry,
  matrix: Matrix4,
  lamps: readonly Lamp[],
  tolerance = 1e-3,
  depth = 2e-3,
): BufferGeometry {
  const flat = geometry.index === null ? geometry.clone() : geometry.toNonIndexed();
  const position = flat.getAttribute('position');
  const slots = new Float32Array(position.count);
  const inside = (l: Lamp, p: Vector3): boolean =>
    [p.x, -p.z, p.y].every((v, axis) => {
      const [a, b] = l.box[axis] ?? [0, 0];
      return v >= a - tolerance && v <= b + tolerance;
    });
  const corners = [new Vector3(), new Vector3(), new Vector3()] as const;
  const [a, b, c] = corners;
  const normal = new Vector3();
  const edge = new Vector3();
  for (let t = 0; t < position.count; t += 3) {
    corners.forEach((v, k) => v.fromBufferAttribute(position, t + k).applyMatrix4(matrix));
    normal.subVectors(c, b).cross(edge.subVectors(a, b)).normalize();
    const point = a.clone().add(b).add(c).divideScalar(3).addScaledVector(normal, -depth);
    const hits = lamps.filter((l) => inside(l, point));
    const [lamp] = hits;
    if (lamp === undefined || hits.length > 1) {
      throw new Error(`shell lens triangle ${t / 3} lies on ${hits.length} lamps of the layout`);
    }
    slots.fill(slotOf(lamp.fns), t, t + 3);
  }
  flat.setAttribute(SLOT_ATTRIBUTE, new Float32BufferAttribute(slots, 1));
  return flat;
}

export type LampEmission = {
  /** The emissive term, shared by every material that draws lenses. */
  readonly node: Node<'vec3'>;
  /** Linear emission per slot, as the shader reads it; the dark slot first. */
  readonly emission: readonly Color[];
  /** Sets every lens slot's emission from `state`. */
  update(state: LampState): void;
};

export function createLampEmission(): LampEmission {
  const lit = LENS_SLOTS.map(([fn]) => new Color(EMISSION[LAMP_COLOURS[fn]]));
  const emission = Array.from({ length: LENS_SLOTS.length + 1 }, () => new Color(0, 0, 0));
  const node = uniformArray(emission, 'color').element(
    attribute<'float'>(SLOT_ATTRIBUTE).add(0.5).toInt(),
  ) as unknown as Node<'vec3'>;
  return {
    node,
    emission,
    update(state) {
      LENS_SLOTS.forEach((fns, index) => {
        const [colour, slot] = [lit[index], emission[index + 1]];
        if (colour === undefined || slot === undefined)
          throw new Error(`no lens slot ${index + 1}`);
        slot.copy(colour).multiplyScalar(lensLevel(state, fns));
      });
    },
  };
}

/** The vehicle detail's vertex-coloured Lambert material, with the lamp emission. */
export function createDetailMaterial(lamps: LampEmission): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial({ vertexColors: true });
  material.emissiveNode = lamps.node;
  return material;
}

/**
 * Gives a shell's meshes their slots: the shell and its glass dark, its lens from `lamps` (the layout's shell
 * lenses). Throws when the glb's lens mesh and the layout disagree, so the procedural mesh stays.
 */
export function slotShell(shell: Shell, lamps: readonly Lamp[]): void {
  if ((shell.lens === null) !== (lamps.length === 0)) {
    throw new Error(
      `shell ${shell.mesh.name} has ${shell.lens === null ? 'no' : 'a'} lens mesh for ${lamps.length} shell lamps`,
    );
  }
  for (const dark of [shell.mesh, shell.glass]) {
    if (dark !== null && !dark.geometry.hasAttribute(SLOT_ATTRIBUTE)) withSlot(dark.geometry);
  }
  if (shell.lens !== null && !shell.lens.geometry.hasAttribute(SLOT_ATTRIBUTE)) {
    shell.lens.geometry = tagShellLenses(shell.lens.geometry, shell.lens.matrixWorld, lamps);
  }
}
