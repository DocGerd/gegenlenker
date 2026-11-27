import { Box3, type BufferGeometry, Layers, Mesh, type Object3D, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import { trailerById, truckById } from '../vehicles/registry';
import { lookFor } from './look';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import {
  CHASE_LAYERS,
  COCKPIT_LAYERS,
  DEFAULT_LAYER,
  enableLayers,
  MIRROR_LAYERS,
  PERSPECTIVE_LAYER,
  SHADOW_CASTER_LAYERS,
  TOP_DOWN_LAYERS,
} from './seams';
import { wheelGeometry } from './vehicle-geometry';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';
import {
  detailedWheel,
  drumReach,
  tyreProfile,
  WHEEL_LOOK,
  type WheelOptions,
} from './wheel-detail';

const R = 0.5;
const W = 0.3;
/** The discs' hub relief past the tyre face: the detailed wheel's outboard bound. */
const DISC_RELIEF = 0.035;
const EPS = 1e-6;

const triangles = (g: BufferGeometry): number =>
  (g.index?.count ?? g.getAttribute('position').count) / 3;

const boundsOf = (parts: readonly BufferGeometry[]): Box3 => {
  const box = new Box3();
  for (const g of parts) {
    g.computeBoundingBox();
    if (g.boundingBox !== null) box.union(g.boundingBox);
  }
  return box;
};

const OPTIONS: readonly WheelOptions[] = [true, false].flatMap((truck) =>
  [1, -1].flatMap((outward) =>
    [
      { rimFace: true, drum: true },
      { rimFace: true, drum: false },
      { rimFace: false, drum: true },
    ].map((faces) => ({ radius: R, width: W, outward: outward as 1 | -1, truck, ...faces })),
  ),
);
const label = (o: WheelOptions): string =>
  `${o.truck ? 'truck' : 'trailer'} ${o.outward > 0 ? 'left' : 'right'}${o.rimFace ? ' rim' : ''}${o.drum ? ' drum' : ''}`;

describe('tyre profile', () => {
  const profile = tyreProfile(R, W);
  const L = WHEEL_LOOK;

  it('runs bead to bead over a tread at the full radius, its sidewalls bulging past the half width', () => {
    expect(profile[0]?.r).toBeCloseTo(R * L.bead);
    expect(profile.at(-1)?.r).toBeCloseTo(R * L.bead);
    expect(Math.max(...profile.map((p) => p.r))).toBeCloseTo(R);
    expect(Math.max(...profile.map((p) => Math.abs(p.h)))).toBeCloseTo(W / 2 + L.bulge);
    expect(profile.map((p) => p.h)).toEqual(profile.map((p) => -p.h).reverse());
  });

  it('rounds the shoulders off the drum corner and cuts the grooves into the tread', () => {
    // a quarter circle of the shoulder radius stays (√2 - 1) of it from the corner
    for (const p of profile) {
      expect(Math.hypot(R - p.r, W / 2 - Math.abs(p.h))).toBeGreaterThan(0.4 * L.shoulder);
    }
    const floors = profile.filter((p) => Math.abs(p.r - (R - L.grooveDepth)) < EPS);
    expect(floors).toHaveLength(2 * L.grooves.length);
  });
});

describe('detailed wheel', () => {
  it(`revolves the tyre in ${String(WHEEL_LOOK.segments)} segments`, () => {
    const [tyre] = detailedWheel(OPTIONS[0] as WheelOptions);
    expect(tyre?.getAttribute('position').count).toBe(
      (WHEEL_LOOK.segments + 1) * tyreProfile(R, W).length,
    );
  });

  it.each(OPTIONS.map((o) => [label(o), o] as const))(
    'faces every triangle the way its normals point (%s)',
    (_label, options) => {
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();
      const n = new Vector3();
      for (const g of detailedWheel(options)) {
        const position = g.getAttribute('position');
        const normal = g.getAttribute('normal');
        const index = g.index;
        if (index === null) throw new Error('wheel parts are indexed');
        let checked = 0;
        for (let i = 0; i < index.count; i += 3) {
          const [i0, i1, i2] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
          a.fromBufferAttribute(position, i0);
          b.fromBufferAttribute(position, i1).sub(a);
          c.fromBufferAttribute(position, i2).sub(a);
          const face = b.cross(c);
          if (face.length() < 1e-9) continue; // a lathe's triangles at the axle
          n.fromBufferAttribute(normal, i0)
            .add(new Vector3().fromBufferAttribute(normal, i1))
            .add(new Vector3().fromBufferAttribute(normal, i2));
          expect(face.dot(n)).toBeGreaterThan(0);
          checked++;
        }
        expect(checked).toBeGreaterThan(0);
      }
    },
  );

  it.each(OPTIONS.map((o) => [label(o), o] as const))(
    'stays inside the tyre radius, past the outboard face no further than the discs did, and inboard only by the drum (%s)',
    (_label, options) => {
      const box = boundsOf(detailedWheel(options));
      expect(box.min.y).toBeGreaterThanOrEqual(-R - EPS);
      expect(box.max.y).toBeLessThanOrEqual(R + EPS);
      expect(Math.max(-box.min.x, box.max.x)).toBeLessThanOrEqual(R + EPS);
      // body y is -z
      const [outboard, inboard] =
        options.outward > 0 ? [-box.min.z, -box.max.z] : [-box.max.z, -box.min.z];
      const out = options.outward;
      expect(outboard * out).toBeLessThanOrEqual(W / 2 + DISC_RELIEF + EPS);
      const reach = options.drum ? drumReach(R, W) : W / 2 + WHEEL_LOOK.bulge;
      expect(-inboard * out).toBeLessThanOrEqual(reach + EPS);
      expect(-inboard * out).toBeGreaterThan(W / 2 - EPS);
    },
  );

  it('costs at most 1300 triangles a wheel', () => {
    for (const options of OPTIONS) {
      const total = detailedWheel(options).reduce((sum, g) => sum + triangles(g), 0);
      expect(total, label(options)).toBeLessThanOrEqual(1300);
    }
  });
});

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o as Mesh);
  });
  return out;
};

function detailBounds(root: Object3D): { box: Box3; triangles: number } {
  root.updateMatrixWorld(true);
  const box = new Box3();
  let count = 0;
  for (const m of meshesOf(root)) {
    if (m.layers.mask === 1 << PERSPECTIVE_LAYER && m.castShadow) {
      box.expandByObject(m);
      count += triangles(m.geometry);
    }
  }
  return { box, triangles: count };
}

type Visual = { object: Object3D; setLook: (look: ReturnType<typeof lookFor>) => void };
const DISCS = QUALITY_FLAGS.low;
const DETAILED = { ...QUALITY_FLAGS.low, wheelDetail: true };

/** The detail with the discs, then with the detailed wheels, and the meshes that changed layer. */
function both(make: () => Visual) {
  const visual = make();
  visual.setLook(lookFor(DISCS, 'day'));
  const discs = detailBounds(visual.object);
  const before = new Map(meshesOf(visual.object).map((m) => [m, m.layers.mask]));
  visual.setLook(lookFor(DETAILED, 'day'));
  const detailed = detailBounds(visual.object);
  const moved = meshesOf(visual.object).filter((m) => before.get(m) !== m.layers.mask);
  const wheels = new Box3();
  for (const m of moved) wheels.expandByObject(m);
  return { visual, before, discs, detailed, moved, wheels };
}

describe('wheelDetail on the vehicles', () => {
  const visuals = [
    ...TRUCK_IDS.map((id) => [id, () => proceduralTruck(truckById(id), palette), 3] as const),
    ...TRAILER_IDS.map((id) => [id, () => proceduralTrailer(trailerById(id), palette), 2] as const),
  ];

  it.each(visuals)(
    'hands the base wheels to the top-down view alone, and restores the discs when off (%s)',
    (_id, make, wheelMeshes) => {
      const { visual, before, moved } = both(make);
      const topDown = new Layers();
      enableLayers(topDown, TOP_DOWN_LAYERS);
      const perspective = [COCKPIT_LAYERS, MIRROR_LAYERS, CHASE_LAYERS].map((ids) => {
        const layers = new Layers();
        enableLayers(layers, ids);
        return layers;
      });
      expect(moved).toHaveLength(wheelMeshes);
      for (const m of moved) {
        expect(before.get(m)).toBe(1 << DEFAULT_LAYER);
        expect(m.layers.test(topDown)).toBe(true);
        for (const layers of perspective) expect(m.layers.test(layers)).toBe(false);
      }
      expect(meshesOf(visual.object)).toHaveLength(before.size);
      const geometries = new Map(meshesOf(visual.object).map((m) => [m, m.geometry]));
      visual.setLook(lookFor(DISCS, 'day'));
      visual.setLook(lookFor(DETAILED, 'day'));
      visual.setLook(lookFor(DISCS, 'day'));
      for (const m of meshesOf(visual.object)) expect(m.layers.mask).toBe(before.get(m));
      visual.setLook(lookFor(DETAILED, 'day'));
      // the detailed builds are made once
      for (const m of meshesOf(visual.object)) expect(m.geometry).toBe(geometries.get(m));
    },
  );

  it.each(visuals)(
    'never reaches below the ground or out of the envelope of the discs and base wheels (%s)',
    (_id, make) => {
      const { discs, detailed, wheels } = both(make);
      const envelope = discs.box.clone().union(wheels);
      expect(detailed.box.min.y).toBeGreaterThanOrEqual(-EPS);
      expect(detailed.box.min.z).toBeGreaterThanOrEqual(envelope.min.z - EPS);
      expect(detailed.box.max.z).toBeLessThanOrEqual(envelope.max.z + EPS);
      expect(detailed.box.min.x).toBeGreaterThanOrEqual(envelope.min.x - EPS);
      expect(detailed.box.max.x).toBeLessThanOrEqual(envelope.max.x + EPS);
    },
  );

  it.each(visuals)("keeps a sun shadow caster on every base wheel's tread (%s)", (_id, make) => {
    const { visual, moved } = both(make);
    visual.object.updateMatrixWorld(true);
    const casters = meshesOf(visual.object).filter((m) => m.castShadow);
    const ray = new Raycaster();
    ray.layers.disableAll();
    enableLayers(ray.layers, SHADOW_CASTER_LAYERS);
    const perWheel = wheelGeometry(1, 1).getAttribute('position').count;
    let wheels = 0;
    for (const mesh of moved) {
      const position = mesh.geometry.getAttribute('position');
      for (let start = 0; start < position.count; start += perWheel) {
        const box = new Box3();
        for (let i = start; i < start + perWheel; i++) {
          box.expandByPoint(
            new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld),
          );
        }
        const centre = box.getCenter(new Vector3());
        ray.set(new Vector3(centre.x, -1, centre.z), new Vector3(0, 1, 0));
        const [hit] = ray.intersectObjects(casters, false);
        expect(hit?.point.y).toBeLessThan(0.01);
        wheels++;
      }
    }
    expect(wheels).toBeGreaterThanOrEqual(4);
  });

  it('adds at most 20k triangles to a truck and trailer pair', () => {
    const added = (make: () => Visual): number => {
      const { discs, detailed } = both(make);
      return detailed.triangles - discs.triangles;
    };
    const worst = (ids: readonly string[]): number =>
      Math.max(...visuals.filter(([id]) => ids.includes(id)).map(([, make]) => added(make)));
    expect(worst(TRUCK_IDS) + worst(TRAILER_IDS)).toBeLessThanOrEqual(20_000);
  });
});
