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
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

const isSchematic = (m: Mesh): boolean => m.material instanceof MeshBasicMaterial;

describe.each(TRUCK_IDS.flatMap((t) => TRAILER_IDS.map((r) => [t, r] as const)))(
  'top-down schematic of %s with %s',
  (truckId, trailerId) => {
    const truck = meshes(proceduralTruck(truckById(truckId), palette).object);
    const trailer = meshes(proceduralTrailer(trailerById(trailerId), palette).object);

    it('exists on the truck and on the dolly and trailer', () => {
      expect(truck.some(isSchematic)).toBe(true);
      expect(trailer.some(isSchematic)).toBe(true);
    });

    it('is seen by the top-down camera only', () => {
      for (const m of [...truck, ...trailer].filter(isSchematic)) {
        expect(m.layers.mask).toBe(1 << AIDS_LAYER);
      }
    });

    it('leaves every mesh the cockpit and mirrors see depth tested', () => {
      const cockpit = new Camera();
      for (const m of [...truck, ...trailer]) {
        if (m.layers.test(cockpit.layers)) expect((m.material as Material).depthTest).toBe(true);
      }
    });
  },
);
