import { Camera, Mesh, MeshBasicMaterial, type Material, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import { trailerById, truckById } from '../vehicles/registry';
import { KEYS } from './palette';
import { AIDS_LAYER } from './seams';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o as Mesh);
  });
  return out;
}

const isSchematic = (m: Mesh): boolean => m.material instanceof MeshBasicMaterial;

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
