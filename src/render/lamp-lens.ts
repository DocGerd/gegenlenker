import { type BufferGeometry, Color, Float32BufferAttribute, type Matrix4, Vector3 } from 'three';
import { attribute, uniformArray } from 'three/tsl';
import { MeshLambertNodeMaterial, type Node } from 'three/webgpu';
import type { Shell } from './glb-shells';
import { type Lamp, LAMP_COLOURS, type LampColour, type LampFn } from './lamp-layout';
import { type LampLevels, lensLevel } from './lamp-state';

/*
 * Switchable lamp lenses. Every vertex of the vehicle detail and the shells carries a `lampSlot`:
 * a lens's slot picks its emission from a uniform array, everything else the dark slot. Lamps
 * switch by that uniform only, so no material, light or shader changes while driving.
 */

/** Every function combination a lens carries (lamp-layout.ts); a lens's slot indexes this list. */
export const LENS_SLOTS = [
  ['dipped-beam'],
  ['front-position'],
  ['front-indicator'],
  ['side-indicator'],
  ['side-marker'],
  ['side-marker', 'side-indicator'],
  ['end-outline-front'],
  ['end-outline-rear'],
  ['rear-position', 'stop'],
  ['rear-indicator'],
  ['reversing'],
  ['rear-fog'],
  ['rear-plate'],
] as const satisfies readonly (readonly LampFn[])[];

export const SLOT_ATTRIBUTE = 'lampSlot';

export function slotOf(fns: readonly LampFn[]): number {
  const key = fns.join('+');
  const slot = LENS_SLOTS.findIndex((s) => s.join('+') === key);
  if (slot < 0) throw new Error(`no lens slot for ${key}`);
  return slot;
}

/** Lit colour of each R48 colour, sRGB. */
const EMISSION: Readonly<Record<LampColour, number>> = {
  white: 0xfff6e8,
  red: 0xff1408,
  amber: 0xff9000,
};

const slotColour = (slot: number): LampColour => {
  const fns: readonly LampFn[] = LENS_SLOTS[slot] ?? [];
  const [fn] = fns;
  if (fn === undefined) throw new Error(`no lens slot ${slot}`);
  return LAMP_COLOURS[fn];
};

/** The slot of everything that is not a lens; it never lights. */
export const DARK_SLOT: number = LENS_SLOTS.length;

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
 * Gives a shell's lens geometry its slots: every vertex, placed by `matrix` (the glTF node's, which
 * undoes the optimiser's quantisation), must lie on the box of one of `lamps` within `tolerance`.
 */
export function tagShellLenses(
  geometry: BufferGeometry,
  matrix: Matrix4,
  lamps: readonly Lamp[],
  tolerance = 5e-3,
): BufferGeometry {
  const position = geometry.getAttribute('position');
  const slots = new Float32Array(position.count);
  const near = ([a, b]: readonly [number, number], v: number): boolean =>
    v >= a - tolerance && v <= b + tolerance;
  const p = new Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(matrix);
    const [x, y, z] = [p.x, -p.z, p.y];
    const lamp = lamps.find((l) => near(l.box[0], x) && near(l.box[1], y) && near(l.box[2], z));
    if (lamp === undefined) throw new Error(`shell lens vertex ${i} lies on no lamp of the layout`);
    slots[i] = slotOf(lamp.fns);
  }
  geometry.setAttribute(SLOT_ATTRIBUTE, new Float32BufferAttribute(slots, 1));
  return geometry;
}

export type LampEmission = {
  /** The emissive term, shared by every material that draws lenses. */
  readonly node: Node<'vec3'>;
  /** Linear emission per slot, as the shader reads it; the dark slot last. */
  readonly emission: readonly Color[];
  /** Sets every slot's emission from `levels`. */
  update(levels: LampLevels): void;
};

export function createLampEmission(): LampEmission {
  const lit = LENS_SLOTS.map((_, slot) => new Color(EMISSION[slotColour(slot)]));
  const emission = [...LENS_SLOTS, []].map(() => new Color(0, 0, 0));
  const node = uniformArray(emission, 'color').element(
    attribute<'float'>(SLOT_ATTRIBUTE).add(0.5).toInt(),
  ) as unknown as Node<'vec3'>;
  return {
    node,
    emission,
    update(levels) {
      LENS_SLOTS.forEach((fns, slot) => {
        const colour = lit[slot];
        if (colour !== undefined)
          emission[slot]?.copy(colour).multiplyScalar(lensLevel(levels, fns));
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

/** Gives a shell's meshes their slots: the shell dark, its lens from `lamps` (the layout's shell lenses). */
export function slotShell(shell: Shell, lamps: readonly Lamp[]): void {
  if (!shell.mesh.geometry.hasAttribute(SLOT_ATTRIBUTE)) withSlot(shell.mesh.geometry);
  if (shell.lens !== null && !shell.lens.geometry.hasAttribute(SLOT_ATTRIBUTE)) {
    tagShellLenses(shell.lens.geometry, shell.lens.matrixWorld, lamps);
  }
}
