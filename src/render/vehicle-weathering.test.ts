import { Mesh, type Object3D, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { lookFor } from './look';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { type VehicleEnvironment, VehicleNodeMaterial } from './vehicle-pbr';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';
import { grimeAt, weatherFrameOf } from './vehicle-weathering';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const env: VehicleEnvironment = {
  attach: () => undefined,
  texture: () => new Texture(),
  onChange: () => () => undefined,
  reportApplied: () => undefined,
  setSky: () => undefined,
  dispose: () => undefined,
};

const reflective = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && o.material instanceof VehicleNodeMaterial) out.push(o as Mesh);
  });
  return out;
};

describe('road grime', () => {
  const r = 0.5;
  const axles = [4, 0];

  it('leaves the upper body clean and fades in towards the ground', () => {
    for (const x of [-2, 2, 6]) expect(grimeAt(x, 2.5, axles, r).grime).toBe(0);
    const at = (h: number) => grimeAt(2, h, axles, r);
    expect(at(0.3).grime).toBeGreaterThan(at(0.8).grime);
    expect(at(0.1).contact).toBeGreaterThan(at(0.6).contact);
  });

  it('is strongest on the arch over each wheel and sprays behind it, not ahead', () => {
    const h = 2 * r + 0.15;
    for (const axle of axles) {
      expect(grimeAt(axle, h, axles, r).grime).toBeGreaterThan(
        grimeAt(axle + 2, h, axles, r).grime,
      );
    }
    const h2 = 0.9;
    expect(grimeAt(-1.2, h2, axles, r).grime).toBeGreaterThan(grimeAt(1.2, h2, axles, r).grime);
  });

  it('adds nothing for an unused axle slot', () => {
    expect(grimeAt(1, 0.8, [0, 1e4, 1e4, 1e4], r)).toEqual(grimeAt(1, 0.8, [0], r));
  });
});

describe('weather frames', () => {
  const high = lookFor(QUALITY_FLAGS.high, 'day');

  it.each(TRUCK_IDS)('puts every reflective mesh of %s on its own axles', (id) => {
    const spec = truckById(id);
    const a = truckAnchors(spec);
    const visual = proceduralTruck(spec, palette, undefined, env);
    visual.setLook(high);
    const worn = reflective(visual.object);
    expect(worn.length).toBeGreaterThan(0);
    for (const mesh of worn) {
      const found = weatherFrameOf(mesh);
      expect(found?.group).toBe(visual.object);
      expect(found?.frame.axles).toEqual([a.frontAxle.x, a.rearAxle.x]);
      expect((mesh.material as VehicleNodeMaterial).weathering.value).toBe(1);
    }
    visual.dispose();
  });

  it.each(TRAILER_IDS)('puts the dolly and trailer of %s on their own axles', (id) => {
    const spec = trailerById(id);
    const a = trailerAnchors(spec);
    const visual = proceduralTrailer(spec, palette, undefined, env);
    visual.setLook(high);
    const [dolly, trailer] = visual.object.children;
    const expected = new Map<Object3D | undefined, number[]>([
      [dolly, [a.frontAxle.x]],
      [trailer, a.rearAxles.map((axle) => axle.x)],
    ]);
    const worn = reflective(visual.object);
    expect(worn.length).toBeGreaterThan(0);
    for (const mesh of worn) {
      const found = weatherFrameOf(mesh);
      expect(found?.frame.axles).toEqual(expected.get(found?.group));
    }
    visual.setLook(lookFor({ ...QUALITY_FLAGS.high, vehicleWeathering: false }, 'day'));
    for (const mesh of reflective(visual.object)) {
      expect((mesh.material as VehicleNodeMaterial).weathering.value).toBe(0);
    }
    visual.dispose();
  });
});
