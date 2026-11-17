import { Box3, Camera, Mesh, type Material, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS, type Param } from '../contracts/vehicle';
import { trailerById, truckById } from '../vehicles/registry';
import { KEYS } from './palette';
import { AIDS_LAYER, SKY_LAYER } from './seams';
import { proceduralTrailer, proceduralTruck, SHADOW_NAME } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o as Mesh);
  });
  return out;
}

const isSchematic = (m: Mesh): boolean => m.layers.mask === 1 << AIDS_LAYER;

const schematicOf = (root: Object3D): Mesh[] => meshes(root).filter(isSchematic);

describe.each([
  ['truck', TRUCK_IDS.map((id) => proceduralTruck(truckById(id), palette).object), 3],
  ['trailer', TRAILER_IDS.map((id) => proceduralTrailer(trailerById(id), palette).object), 2],
] as const)('top-down schematic of the %s', (_kind, objects, count) => {
  it.each(objects.map((o, i) => [i, o] as const))(
    'has exactly the expected meshes, drawn over the body and seen by the top-down camera only (#%i)',
    (_i, object) => {
      const plan = schematicOf(object);
      expect(plan).toHaveLength(count);
      for (const m of plan) {
        expect((m.material as Material).depthTest).toBe(false);
        expect(m.renderOrder).toBeGreaterThan(0);
        expect(m.layers.mask).toBe(1 << AIDS_LAYER);
      }
    },
  );

  it.each(objects.map((o, i) => [i, o] as const))(
    'leaves every mesh the cockpit and mirrors see depth tested (#%i)',
    (_i, object) => {
      const cockpit = new Camera();
      for (const m of meshes(object)) {
        if (m.layers.test(cockpit.layers)) expect((m.material as Material).depthTest).toBe(true);
      }
    },
  );
});

const detailOf = (root: Object3D): Mesh[] =>
  meshes(root).filter((m) => m.layers.mask === 1 << SKY_LAYER && m.name !== SHADOW_NAME);

const shadowsOf = (root: Object3D): Mesh[] => meshes(root).filter((m) => m.name === SHADOW_NAME);

/** Half-width of the perspective detail in body y (Three z). */
function detailHalfWidth(root: Object3D): number {
  root.updateMatrixWorld(true);
  const bounds = new Box3();
  for (const m of detailOf(root)) bounds.expandByObject(m);
  return Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
}

function expectDetailFollowsWidth<T extends { width: Param }>(
  spec: T,
  make: (spec: T) => Object3D,
): void {
  const topDown = new Camera();
  topDown.layers.enable(AIDS_LAYER);
  const object = make(spec);
  expect(detailOf(object).length).toBeGreaterThan(0);
  for (const m of detailOf(object)) expect(m.layers.test(topDown.layers)).toBe(false);

  const half = spec.width.value / 2000;
  const narrow = detailHalfWidth(object);
  expect(narrow).toBeGreaterThanOrEqual(half);
  expect(narrow).toBeLessThan(half + 0.1);
  const wide = make({ ...spec, width: { ...spec.width, value: spec.width.value + 400 } });
  expect(detailHalfWidth(wide)).toBeCloseTo(narrow + 0.2, 5);
}

describe('perspective detail', () => {
  it.each(TRUCK_IDS)('stays off the top-down camera and follows the width Param (%s)', (id) => {
    expectDetailFollowsWidth(truckById(id), (s) => proceduralTruck(s, palette).object);
  });

  it.each(TRAILER_IDS)('stays off the top-down camera and follows the width Param (%s)', (id) => {
    expectDetailFollowsWidth(trailerById(id), (s) => proceduralTrailer(s, palette).object);
  });
});

describe('blob shadows', () => {
  const visuals = [
    ...TRUCK_IDS.map(
      (id) => ['truck', id, proceduralTruck(truckById(id), palette).object] as const,
    ),
    ...TRAILER_IDS.map(
      (id) => ['trailer', id, proceduralTrailer(trailerById(id), palette).object] as const,
    ),
  ];

  it.each(visuals)(
    '%s %s: perspective only, blended over the ground without writing depth',
    (_k, _id, object) => {
      const topDown = new Camera();
      topDown.layers.enable(AIDS_LAYER);
      const cockpit = new Camera();
      cockpit.layers.enable(SKY_LAYER);
      expect(shadowsOf(object).length).toBeGreaterThan(0);
      for (const m of shadowsOf(object)) {
        const material = m.material as Material;
        expect(m.layers.test(topDown.layers)).toBe(false);
        expect(m.layers.test(cockpit.layers)).toBe(true);
        expect(material.transparent).toBe(true);
        expect(material.depthWrite).toBe(false);
      }
    },
  );

  it.each(TRAILER_IDS)('follows the dolly and the trailer body separately (%s)', (id) => {
    const object = proceduralTrailer(trailerById(id), palette).object;
    expect(object.children.map((part) => shadowsOf(part).length)).toEqual([1, 1]);
  });
});
