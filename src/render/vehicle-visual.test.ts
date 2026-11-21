import {
  BoxGeometry,
  Box3,
  Camera,
  Group,
  Layers,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { setGradeDisabled } from './grade';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS, type Param } from '../contracts/vehicle';
import { createSimulation } from '../sim/simulation';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { KEYS } from './palette';
import { lookFor } from './look';
import { QUALITY_FLAGS } from './quality';
import { applyShell } from './glb-shells';
import { createMirror } from './mirror';
import {
  AIDS_LAYER,
  CAB_LAYER,
  COCKPIT_LAYERS,
  enableLayers,
  PERSPECTIVE_LAYER,
  TOP_DOWN_LAYERS,
  YARD_CASTER_LAYER,
} from './seams';
import {
  GLOW_NAME,
  proceduralTrailer,
  proceduralTruck,
  SHADOW_HEIGHT,
  SHADOW_NAME,
  TWIN_NAME,
} from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o as Mesh);
  });
  return out;
}

const isSchematic = (m: Mesh): boolean => m.layers.mask === 1 << AIDS_LAYER && m.name !== TWIN_NAME;

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
  meshes(root).filter(
    (m) =>
      m.layers.mask === 1 << PERSPECTIVE_LAYER && m.name !== SHADOW_NAME && m.name !== GLOW_NAME,
  );

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

describe('cab front', () => {
  it.each(TRUCK_IDS)(
    'is hidden from the cockpit eye inside the cab but not the mirrors (%s)',
    (id) => {
      const cockpit = new Layers();
      enableLayers(cockpit, COCKPIT_LAYERS);
      const topDown = new Layers();
      enableLayers(topDown, TOP_DOWN_LAYERS);
      const mirror = createMirror().camera.layers;
      const cab = meshes(proceduralTruck(truckById(id), palette).object).filter(
        (m) => m.layers.mask === 1 << CAB_LAYER,
      );
      expect(cab.length).toBeGreaterThan(0);
      for (const m of cab) {
        expect(m.layers.test(cockpit)).toBe(false);
        expect(m.layers.test(mirror)).toBe(true);
        expect(m.layers.test(topDown)).toBe(false);
      }
    },
  );
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
      cockpit.layers.enable(PERSPECTIVE_LAYER);
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

  /** World-space vertices of the shadow meshes under `root`, as body-frame (x, y) plus height. */
  function footprint(root: Object3D): { x: number; y: number; h: number }[] {
    root.updateMatrixWorld(true);
    const out: { x: number; y: number; h: number }[] = [];
    for (const m of shadowsOf(root)) {
      const position = m.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        const v = new Vector3().fromBufferAttribute(position, i).applyMatrix4(m.matrixWorld);
        out.push({ x: v.x, y: -v.z, h: v.y });
      }
    }
    return out;
  }

  /** A blob centre is its fan's first vertex, so it must sit exactly on the wheel contact point. */
  function expectCentresAt(root: Object3D, centres: readonly (readonly [number, number])[]): void {
    const points = footprint(root);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect(p.h).toBeCloseTo(SHADOW_HEIGHT, 5);
    for (const [x, y] of centres) {
      expect(points.some((p) => Math.abs(p.x - x) < 1e-5 && Math.abs(p.y - y) < 1e-5)).toBe(true);
    }
  }

  function expectCovers(root: Object3D, x0: number, x1: number, halfWidth: number): void {
    const points = footprint(root);
    expect(Math.min(...points.map((p) => p.x))).toBeLessThanOrEqual(x0);
    expect(Math.max(...points.map((p) => p.x))).toBeGreaterThanOrEqual(x1);
    expect(Math.max(...points.map((p) => p.y))).toBeGreaterThanOrEqual(halfWidth);
    expect(Math.min(...points.map((p) => p.y))).toBeLessThanOrEqual(-halfWidth);
  }

  it.each(TRUCK_IDS)('truck %s: sits under the wheels and body of the spec', (id) => {
    const base = truckById(id);
    const widened = {
      ...base,
      rearTrack: { ...base.rearTrack, value: base.rearTrack.value + 400 },
      frontTrack: { ...base.frontTrack, value: base.frontTrack.value + 400 },
    };
    for (const spec of [base, widened]) {
      const a = truckAnchors(spec);
      const rear = spec.rearTrack.value / 2000;
      const front = spec.frontTrack.value / 2000;
      const object = proceduralTruck(spec, palette).object;
      expectCentresAt(object, [
        [a.rearAxle.x, rear],
        [a.rearAxle.x, -rear],
        [a.frontAxle.x, front],
        [a.frontAxle.x, -front],
      ]);
      expectCovers(object, a.rearX, a.frontX, spec.width.value / 2000);
    }
  });

  it.each(TRAILER_IDS)('trailer %s: sits under the wheels and body of the spec', (id) => {
    const base = trailerById(id);
    const widened = { ...base, track: { ...base.track, value: base.track.value + 400 } };
    for (const spec of [base, widened]) {
      const a = trailerAnchors(spec);
      const half = spec.track.value / 2000;
      const [dolly, trailer] = proceduralTrailer(spec, palette).object.children;
      if (dolly === undefined || trailer === undefined) throw new Error('missing trailer parts');
      expectCentresAt(dolly, [
        [a.frontAxle.x, half],
        [a.frontAxle.x, -half],
      ]);
      expectCentresAt(
        trailer,
        a.rearAxles.flatMap((axle) => [[axle.x, half] as const, [axle.x, -half] as const]),
      );
      expectCovers(trailer, a.rearX, a.frontX, spec.width.value / 2000);
    }
  });
});

describe('number plate grade', () => {
  const plates = (root: Object3D): Mesh[] =>
    meshes(root).filter((m) => {
      const material = m.material as Material & { vertexColors?: boolean; isNodeMaterial?: true };
      return (
        m.layers.mask === 1 << PERSPECTIVE_LAYER &&
        material.isNodeMaterial === true &&
        !material.vertexColors
      );
    });

  it.each([
    ['truck', () => proceduralTruck(truckById(TRUCK_IDS[0]), palette)],
    ['trailer', () => proceduralTrailer(trailerById(TRAILER_IDS[0]), palette)],
  ] as const)('grades the %s plate on High only', (_kind, build) => {
    const visual = build();
    const found = plates(visual.object);
    expect(found.length).toBeGreaterThan(0);
    const graded = (): boolean[] =>
      found.map((m) => (m.material as unknown as { outputNode: unknown }).outputNode !== null);
    for (const [flags, on] of [
      [QUALITY_FLAGS.high, true],
      [QUALITY_FLAGS.balanced, false],
      [QUALITY_FLAGS.low, false],
      [QUALITY_FLAGS.high, true],
    ] as const) {
      visual.setLook(lookFor(flags, 'day'));
      expect(graded().every((g) => g === on)).toBe(true);
    }
    visual.setLook(lookFor(QUALITY_FLAGS.balanced, 'night'));
    expect(graded().some((g) => g)).toBe(false);
    visual.dispose();
  });
});

const atRest = () =>
  createSimulation(
    resolveCombination(truckById(TRUCK_IDS[0]), trailerById(TRAILER_IDS[0])),
    { truck: { x: 0, y: 0, heading: 0 } },
    () => null,
  ).snapshot();

describe('sun shadow', () => {
  afterEach(() => {
    setGradeDisabled(false);
  });
  const visuals = [
    ...TRUCK_IDS.map((id) => proceduralTruck(truckById(id), palette)),
    ...TRAILER_IDS.map((id) => proceduralTrailer(trailerById(id), palette)),
  ];
  const isPlate = (m: Mesh): boolean => {
    const material = m.material as Material & { vertexColors?: boolean; isNodeMaterial?: true };
    return material.isNodeMaterial === true && !material.vertexColors;
  };
  const bodies = (root: Object3D): Mesh[] =>
    meshes(root).filter(
      (m) =>
        m.name !== SHADOW_NAME &&
        m.name !== GLOW_NAME &&
        m.name !== TWIN_NAME &&
        !isPlate(m) &&
        !isSchematic(m),
    );

  it.each(visuals.map((v, i) => [i, v] as const))(
    'lets the bodies cast and take the sun, and the blobs and plates cast nothing (#%i)',
    (_i, visual) => {
      expect(bodies(visual.object).length).toBeGreaterThan(0);
      for (const m of bodies(visual.object)) {
        expect(m.castShadow).toBe(true);
        expect(m.receiveShadow).toBe(true);
      }
      for (const m of shadowsOf(visual.object)) {
        expect(m.castShadow).toBe(false);
        expect(m.receiveShadow).toBe(false);
      }
      for (const m of meshes(visual.object).filter(isPlate)) {
        expect(m.castShadow).toBe(false);
        expect(m.receiveShadow).toBe(true);
      }
    },
  );

  it.each(visuals.map((v, i) => [i, v] as const))(
    "stays out of the floodlights' static shadow maps, at every look (#%i)",
    (_i, visual) => {
      for (const flags of Object.values(QUALITY_FLAGS)) {
        for (const mode of ['day', 'night'] as const) {
          visual.setLook(lookFor(flags, mode));
          for (const m of meshes(visual.object)) {
            expect(m.layers.isEnabled(YARD_CASTER_LAYER), `${mode} ${m.name}`).toBe(false);
          }
        }
      }
    },
  );

  it.each(visuals.map((v, i) => [i, v] as const))(
    'paler blobs while the sun shadows, as the flags say (#%i)',
    (_i, visual) => {
      const opacities = (): number[] =>
        shadowsOf(visual.object).map((m) => (m.material as Material).opacity);
      for (const flags of [
        QUALITY_FLAGS.high,
        QUALITY_FLAGS.balanced,
        QUALITY_FLAGS.low,
        QUALITY_FLAGS.high,
      ]) {
        visual.setLook(lookFor(flags, 'day'));
        for (const opacity of opacities()) {
          if (flags.sunShadow) {
            expect(opacity).toBeGreaterThan(0);
            expect(opacity).toBeLessThan(1);
          } else expect(opacity).toBe(1);
        }
      }
    },
  );

  it('keeps the blobs at night on a preset without sun shadow', () => {
    for (const visual of visuals) {
      visual.setLook(lookFor(QUALITY_FLAGS.balanced, 'night'));
      for (const m of shadowsOf(visual.object)) expect((m.material as Material).opacity).toBe(1);
    }
  });

  it('keeps the blobs at night on high, where the sun casts no shadow', () => {
    for (const visual of visuals) {
      visual.setLook(lookFor(QUALITY_FLAGS.high, 'night'));
      for (const m of shadowsOf(visual.object)) expect((m.material as Material).opacity).toBe(1);
    }
  });

  it('restores the blobs once a failed grade stops the sun casting', () => {
    const visual = proceduralTruck(truckById(TRUCK_IDS[0]), palette);
    visual.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    const opacity = (): number => (shadowsOf(visual.object)[0]?.material as Material).opacity;
    expect(opacity()).toBeLessThan(1);
    setGradeDisabled(true);
    visual.update(atRest());
    expect(opacity()).toBe(1);
    setGradeDisabled(false);
    visual.update(atRest());
    expect(opacity()).toBeLessThan(1);
  });

  it('lets a shell body cast, and its glass and lenses only take shadow', () => {
    const body = new Mesh(new BoxGeometry());
    const glass = new Mesh(new BoxGeometry());
    const lens = new Mesh(new BoxGeometry());
    const group = new Group();
    const swap = applyShell(
      group,
      { mesh: body, glass, lens },
      { toAids: [], remove: [], layer: PERSPECTIVE_LAYER },
      { material: new MeshBasicMaterial() },
    );
    const [shell, shellGlass, shellLens] = meshes(group);
    expect([shell?.castShadow, shell?.receiveShadow]).toEqual([true, true]);
    expect([shellGlass?.castShadow, shellGlass?.receiveShadow]).toEqual([false, true]);
    expect([shellLens?.castShadow, shellLens?.receiveShadow]).toEqual([false, true]);
    swap.dispose();
  });
});
