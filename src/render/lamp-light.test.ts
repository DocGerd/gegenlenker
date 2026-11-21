import {
  Group,
  HalfFloatType,
  Layers,
  LinearFilter,
  type Light,
  type Object3D,
  SpotLight,
  Texture,
  Vector4,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import { createSimulation } from '../sim/simulation';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import {
  BEAM,
  beamPattern,
  candela,
  createLampLights,
  drawbarGap,
  GROUND,
  groundIrradiancePerCandela,
  lampLitSample,
  litGround,
  type LampLightSpec,
  trailerLampLight,
  trailerPattern,
  truckLampLights,
} from './lamp-light';
import { trailerLamps, truckLamps } from './lamp-layout';
import { TRUCK_LOOKS } from './livery';
import { NIGHT_AMBIENT, NIGHT_TINT, PEAK_HEADROOM } from './light-rig';
import { lookFor } from './look';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import {
  AIDS_LAYER,
  CHASE_LAYERS,
  COCKPIT_LAYERS,
  DEFAULT_LAYER,
  enableLayers,
  MIRROR_LAYERS,
  PERSPECTIVE_LAYER,
} from './seams';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const env = {
  attach: () => undefined,
  texture: () => new Texture(),
  onChange: () => () => undefined,
  reportApplied: () => undefined,
  setSky: () => undefined,
  dispose: () => undefined,
};

const night = (preset: 'balanced' | 'high') => lookFor(QUALITY_FLAGS[preset], 'night');

/** Highest irradiance the night ambient puts on any surface. */
const AMBIENT_PEAK = NIGHT_AMBIENT * Math.PI * Math.max(...NIGHT_TINT);
const HEADROOM = PEAK_HEADROOM * Math.PI;

const specsOf = (truck: TruckId, trailer: TrailerId): readonly LampLightSpec[] => [
  ...truckLampLights(truckById(truck)),
  trailerLampLight(trailerById(trailer)),
];

const PAIRS = TRUCK_IDS.flatMap((truck) => TRAILER_IDS.map((trailer) => [truck, trailer] as const));

describe('lamp light placement', () => {
  it.each(TRUCK_IDS)('puts the %s truck lights outside the lenses they stand for', (id) => {
    const spec = truckById(id);
    const { lamps } = truckLamps(spec);
    const [front, rear] = truckLampLights(spec);
    const dipped = lamps.filter((l) => l.fns.includes('dipped-beam'));
    const reversing = lamps.filter((l) => l.fns.includes('reversing'));
    expect(front?.id).toBe('truck-front');
    expect(rear?.id).toBe('truck-rear');
    if (front === undefined || rear === undefined) return;
    expect(dipped).toHaveLength(2);
    expect(front.position.x).toBeGreaterThan(Math.max(...dipped.map((l) => l.box[0][1])));
    expect(front.position.x).toBeGreaterThan(truckAnchors(spec).frontX);
    expect(rear.position.x).toBeLessThan(Math.min(...reversing.map((l) => l.box[0][0])));
    for (const [light, group] of [
      [front, dipped],
      [rear, reversing],
    ] as const) {
      // one light between the two lamps of the pair
      expect(light.position.y).toBeCloseTo(0, 6);
      const zs = group.flatMap((l) => l.box[2]);
      expect(light.position.z).toBeGreaterThan(Math.min(...zs));
      expect(light.position.z).toBeLessThan(Math.max(...zs));
    }
    expect(front.aim.x).toBeGreaterThan(0.99);
    expect(rear.aim.x).toBeLessThan(-0.8);
    for (const light of [front, rear]) expect(light.aim.z).toBeLessThan(0);
  });

  it.each(TRAILER_IDS)('puts the %s trailer light behind its reversing lamps', (id) => {
    const spec = trailerById(id);
    const light = trailerLampLight(spec);
    const reversing = trailerLamps(spec, 'shell').lamps.filter((l) => l.fns.includes('reversing'));
    expect(reversing).toHaveLength(2);
    expect(light.position.x).toBeLessThan(trailerAnchors(spec).rearX);
    expect(light.position.x).toBeLessThan(Math.min(...reversing.map((l) => l.box[0][0])));
    expect(light.aim.x).toBeLessThan(-0.8);
  });

  it.each(PAIRS)('ends the %s truck rear light before the %s trailer', (truck, trailer) => {
    const t = truckById(truck);
    const rear = truckLampLights(t).find((l) => l.id === 'truck-rear');
    expect(rear).toBeDefined();
    if (rear === undefined) return;
    // a ray can only go further than the straight distance to the trailer's front plane
    const toFront = rear.position.x - (truckAnchors(t).rearX - drawbarGap(t, trailerById(trailer)));
    expect(rear.distance).toBeGreaterThan(0);
    expect(rear.distance).toBeLessThanOrEqual(toFront);
  });
});

describe('lamp light levels', () => {
  const finest = 300;

  it.each(PAIRS)(
    'keeps the %s truck and %s trailer lamps inside the 8-bit headroom',
    (truck, trailer) => {
      for (const spec of specsOf(truck, trailer)) {
        const cd = candela(spec);
        const peak = groundIrradiancePerCandela(spec, finest);
        const worst = spec.id === 'truck-front' ? cd.white * peak : (cd.white + cd.red) * peak;
        expect(worst + AMBIENT_PEAK, spec.id).toBeLessThanOrEqual(HEADROOM);
        if (spec.work === undefined) continue;
        // the work cone takes over the reversing and stop lamps' light, at the same peaks
        const working = candela(spec, true);
        const workPeak = groundIrradiancePerCandela({ ...spec, ...spec.work }, finest);
        expect(working.white * workPeak, `${spec.id} reversing`).toBeCloseTo(GROUND.reversing, 2);
        expect(
          (working.white + working.red) * workPeak + AMBIENT_PEAK,
          `${spec.id} with the work floodlights`,
        ).toBeLessThanOrEqual(HEADROOM);
      }
    },
  );

  /** The rearmost ground x the light lights above `level`, its irradiance at the candela as set. */
  const reachBack = (spec: LampLightSpec, work: boolean, level = 0.1): number => {
    const cone = work && spec.work !== undefined ? { ...spec, ...spec.work } : spec;
    const { white, red } = candela(spec, work);
    const lit = litGround(cone, 200).filter((p) => p.irradiance * (white + red) > level);
    return Math.min(...lit.map((p) => p.x));
  };

  it('stands the truck work light over the body, above the reversing lamps', () => {
    for (const truck of TRUCK_IDS) {
      const spec = truckById(truck);
      const rear = truckLampLights(spec).find((l) => l.id === 'truck-rear');
      const work = rear?.work;
      if (rear === undefined || work === undefined) throw new Error(`no work light on ${truck}`);
      const reversing = truckLamps(spec).lamps.filter((l) => l.fns.includes('reversing'));
      const workLamps = truckLamps(spec, TRUCK_LOOKS[truck].cab.length).lamps.filter((l) =>
        l.fns.includes('work'),
      );
      expect(workLamps).toHaveLength(2);
      expect(work.position.y).toBeCloseTo(0, 6);
      expect(work.position.z).toBeGreaterThan(Math.max(...reversing.map((l) => l.box[2][1])));
      expect(work.position.x).toBeLessThan(Math.min(...workLamps.map((l) => l.box[0][0])));
      expect(work.aim.z, 'flatter than the reversing light').toBeGreaterThan(rear.aim.z);
      expect(work.aim.x).toBeLessThan(-0.8);
      expect(work.angle).toBe(rear.angle);
    }
  });

  it.each(PAIRS)(
    'lights the ground behind the %s truck at least as far back as the reversing light, not under the %s trailer',
    (truck, trailer) => {
      const spec = truckById(truck);
      const rear = truckLampLights(spec).find((l) => l.id === 'truck-rear');
      if (rear?.work === undefined) throw new Error(`no work light on ${truck}`);
      const trailerFront = truckAnchors(spec).rearX - drawbarGap(spec, trailerById(trailer));
      expect(reachBack(rear, true)).toBeLessThanOrEqual(reachBack(rear, false));
      // under the trailer the pool is down to a sliver of its peak
      const under = litGround({ ...rear, ...rear.work }, 200)
        .filter((p) => p.x < trailerFront)
        .map((p) => p.irradiance * candela(rear, true).white);
      expect(Math.max(...under)).toBeLessThan(0.05 * GROUND.reversing);
    },
  );

  it.each(TRAILER_IDS)(
    'stands the %s trailer work light above its reversing lamps, lighting as far back as they do',
    (id) => {
      const spec = trailerById(id);
      const light = trailerLampLight(spec);
      const work = light.work;
      if (work === undefined) throw new Error(`no work light on ${id}`);
      const lamps = trailerLamps(spec, 'shell').lamps;
      const reversing = lamps.filter((l) => l.fns.includes('reversing'));
      const workLamps = lamps.filter((l) => l.fns.includes('work'));
      expect(workLamps).toHaveLength(2);
      expect(work.position.y).toBeCloseTo(0, 6);
      expect(work.position.z).toBeGreaterThan(Math.max(...reversing.map((l) => l.box[2][1])));
      expect(work.position.x).toBeLessThan(Math.min(...workLamps.map((l) => l.box[0][0])));
      expect(work.aim).toEqual(light.aim);
      expect(work.angle).toBe(light.angle);
      expect(reachBack(light, true)).toBeLessThanOrEqual(reachBack(light, false));
    },
  );

  it('puts the trailer light peak a few metres behind the lamp, where the mirrors look', () => {
    for (const id of TRAILER_IDS) {
      const spec = trailerLampLight(trailerById(id));
      const ground = litGround(spec, 200);
      const peak = Math.max(...ground.map((p) => p.irradiance));
      const near = ground.filter((p) => spec.position.x - p.x < 1);
      const pool = ground.filter((p) => {
        const back = spec.position.x - p.x;
        return back >= 3 && back <= 6;
      });
      const far = ground.filter((p) => spec.position.x - p.x >= 8 && spec.position.x - p.x <= 10);
      expect(Math.max(...pool.map((p) => p.irradiance)), id).toBeGreaterThan(0.9 * peak);
      expect(Math.max(...near.map((p) => p.irradiance)), `${id} under the lamp`).toBeLessThan(
        0.5 * peak,
      );
      expect(Math.max(...far.map((p) => p.irradiance)), `${id} 8 to 10 m back`).toBeGreaterThan(
        0.03 * peak,
      );
    }
  });

  it('lights the headlamp pool along the whole stretch ahead, brightest near the lamp', () => {
    for (const id of TRUCK_IDS) {
      const spec = truckLampLights(truckById(id))[0];
      if (spec === undefined) throw new Error('no front light');
      const ground = litGround(spec, 200);
      const ahead = (from: number, to: number): number =>
        Math.max(
          ...ground
            .filter((p) => p.x - spec.position.x >= from && p.x - spec.position.x < to)
            .map((p) => p.irradiance),
        );
      const peak = Math.max(...ground.map((p) => p.irradiance));
      expect(ahead(2, 5), id).toBeGreaterThan(0.8 * peak);
      expect(ahead(8, 12), id).toBeGreaterThan(0.25 * peak);
      expect(ahead(18, 24), id).toBeGreaterThan(0.05 * peak);
      expect(ahead(30, 100), `${id} past the cut-off`).toBeLessThan(0.05 * peak);
    }
  });

  it('lights the ground ahead of the headlamps and behind the reversing lamps', () => {
    for (const [truck, trailer] of PAIRS) {
      for (const spec of specsOf(truck, trailer)) {
        const xs = litGround(spec).map((p) => p.x);
        const behind = spec.id !== 'truck-front';
        const reach = behind
          ? spec.position.x - Math.min(...xs)
          : Math.max(...xs) - spec.position.x;
        const wrongWay = behind
          ? Math.max(...xs) - spec.position.x
          : spec.position.x - Math.min(...xs);
        expect(wrongWay, `${spec.id} on its back`).toBeLessThanOrEqual(0);
        expect(reach, spec.id).toBeGreaterThan(spec.id === 'truck-front' ? 15 : 1);
      }
    }
  });
});

/** The beam's map coordinates of a body-frame point, through the light's own shadow camera as three samples the map. */
function mapCoordinates(light: SpotLight, parent: Group, point: [number, number, number]) {
  parent.updateMatrixWorld(true);
  light.shadow.updateMatrices(light);
  const [x, y, z] = point;
  const clip = new Vector4(x, z, -y, 1).applyMatrix4(light.shadow.matrix);
  return { u: clip.x / clip.w, v: clip.y / clip.w };
}

describe('the dipped beam map', () => {
  const spec = truckLampLights(truckById(TRUCK_IDS[0]))[0];
  if (spec === undefined) throw new Error('no front light');
  const build = () => {
    const parent = new Group();
    const lights = createLampLights([spec], parent);
    const [light] = lights.lights;
    if (light === undefined) throw new Error('no light');
    return { parent, lights, light };
  };
  /** A point `ahead` metres in front of the lamp at `elevation` degrees, `left` metres to its left. */
  const ray = (ahead: number, elevation: number, left: number): [number, number, number] => [
    spec.position.x + ahead,
    left,
    spec.position.z + ahead * Math.tan((elevation * Math.PI) / 180),
  ];
  const share = (elevation: number, left: number): number => {
    const { parent, lights, light } = build();
    const { u, v } = mapCoordinates(light, parent, ray(20, elevation, left));
    lights.dispose();
    return beamPattern(u, v);
  };

  it('lights the ground ahead and nothing above the cut-off', () => {
    expect(share(-4, 0)).toBeGreaterThan(0.1);
    expect(share(3, 0)).toBe(0);
    expect(share(10, 0)).toBe(0);
  });

  it('keeps the cut-off low on the left and lifts it on the right, for right-hand traffic', () => {
    // 20 m ahead, a metre off the axis: about three degrees
    expect(share(-1, 3), 'left, above the low cut-off').toBeLessThan(0.01);
    expect(share(-1, -3), 'right, below the lifted cut-off').toBeGreaterThan(0.1);
  });

  it('reads its map as linear half floats and lights nothing through the near field unmasked', () => {
    const { lights, light } = build();
    expect(light.map?.minFilter).toBe(LinearFilter);
    expect(light.map?.magFilter).toBe(LinearFilter);
    expect(light.map?.type).toBe(HalfFloatType);
    expect(light.shadow.camera.near).toBeLessThan(0.1);
    expect(light.castShadow).toBe(false);
    lights.dispose();
  });

  /** Map point of the ray at `elevation` and `azimuth` degrees, found from the cone's geometry alone. */
  const mapPoint = (elevation: number, azimuth: number): [number, number] => {
    const [e, a] = [elevation, azimuth].map((d) => (d * Math.PI) / 180) as [number, number];
    // frame: x ahead, y to the right, z up
    const ray = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)] as const;
    const axis = [Math.cos(BEAM.pitch), 0, -Math.sin(BEAM.pitch)] as const;
    const up = [Math.sin(BEAM.pitch), 0, Math.cos(BEAM.pitch)] as const;
    const dot = (p: readonly number[], q: readonly number[]): number =>
      p.reduce((sum, v, i) => sum + v * (q[i] ?? 0), 0);
    const depth = dot(ray, axis);
    const reach = Math.tan(BEAM.angle);
    return [
      0.5 + dot(ray, [0, 1, 0]) / depth / (2 * reach),
      0.5 + dot(ray, up) / depth / (2 * reach),
    ];
  };

  it('shapes the beam as designed at known directions', () => {
    const at = (elevation: number, azimuth: number): number =>
      beamPattern(...mapPoint(elevation, azimuth));
    // below the cut-off on the axis: (2.5 / 4)^2.5 of the peak
    expect(at(-4, 0)).toBeCloseTo(0.3, 1);
    expect(at(-3, 0)).toBeCloseTo(0.63, 1);
    // low cut-off on the left: lit below -2.8 degrees, dark above -2
    expect(at(-3.5, -10)).toBeGreaterThan(0.2);
    expect(at(-1.5, -10)).toBe(0);
    // the cut-off rises on the right: the same direction is lit there
    expect(at(-1.5, 10)).toBeGreaterThan(0.5);
    expect(at(2, 10)).toBe(0);
    // the sideways spread dims the edge of the cone
    expect(at(-4, 25)).toBeLessThan(0.5 * at(-4, 0));
  });

  it('makes the trailer light full strength to 11 degrees below the horizon and dimmer below', () => {
    const [light] = createLampLights(
      [trailerLampLight(trailerById(TRAILER_IDS[0]))],
      new Group(),
    ).lights;
    expect(light?.map?.type).toBe(HalfFloatType);
    expect(trailerPattern(0.5, 0.9)).toBe(1);
    expect(trailerPattern(0.5, 0.05)).toBeLessThan(0.1);
  });
});

/** A standstill snapshot of the combination with `control` applied. */
function snapshotWith(
  truck: TruckId,
  trailer: TrailerId,
  control: Partial<SimSnapshot['control']>,
): SimSnapshot {
  const sim = createSimulation(
    resolveCombination(truckById(truck), trailerById(trailer)),
    { truck: { x: 0, y: 0, heading: 0 } },
    () => null,
  );
  const snapshot = sim.snapshot();
  return { ...snapshot, control: { ...snapshot.control, ...control } };
}

const spotsOf = (root: Object3D): SpotLight[] => {
  const out: SpotLight[] = [];
  root.traverse((o) => {
    if (o instanceof SpotLight) out.push(o);
  });
  return out;
};

const lightsOf = (root: Object3D): Light[] => {
  const out: Light[] = [];
  root.traverse((o) => {
    if ('isLight' in o) out.push(o as Light);
  });
  return out;
};

const STATES: readonly Partial<SimSnapshot['control']>[] = [
  { gear: 'P', brake: false },
  { gear: 'R', brake: false },
  { gear: 'R', brake: true },
  { gear: 'D', brake: true },
  { gear: 'D', brake: false },
];

describe('lamp light in the vehicle visuals', () => {
  const visuals = [
    ['truck', () => proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env), 2],
    ['trailer', () => proceduralTrailer(trailerById(TRAILER_IDS[0]), palette, undefined, env), 1],
  ] as const;

  it.each(visuals)('keeps the %s light set fixed while the lamps change', (_name, make, count) => {
    const visual = make();
    visual.setLook(night('balanced'));
    const lights = spotsOf(visual.object);
    expect(lights).toHaveLength(count);
    // what the lit programs are keyed on; the cone's distance and position follow the work lamps
    const settled = lights.map((l) => [l.visible, l.castShadow, l.map, l.angle]);
    for (const control of STATES) {
      visual.update(snapshotWith(TRUCK_IDS[0], TRAILER_IDS[0], control));
      expect(spotsOf(visual.object)).toEqual(lights);
      expect(lights.map((l) => [l.visible, l.castShadow, l.map, l.angle])).toEqual(settled);
    }
    expect(lights.every((l) => l.visible && !l.castShadow)).toBe(true);
    visual.dispose();
  });

  const rearLights = [
    [
      'truck-rear',
      () => proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env),
      () => truckLampLights(truckById(TRUCK_IDS[0])).find((l) => l.id === 'truck-rear'),
    ],
    [
      'trailer-rear',
      () => proceduralTrailer(trailerById(TRAILER_IDS[0]), palette, undefined, env),
      () => trailerLampLight(trailerById(TRAILER_IDS[0])),
    ],
  ] as const;

  it.each(rearLights)(
    'swaps the %s light to the work cone in R with the lights on, keeping the light set',
    (name, make, specOf) => {
      const visual = make();
      visual.setLook(night('balanced'));
      const lights = spotsOf(visual.object);
      const rear = lights.find((l) => l.name === name);
      const rearSpec = specOf();
      const work = rearSpec?.work;
      if (rear === undefined || rearSpec === undefined || work === undefined)
        throw new Error('no work light');
      const settled = lights.map((l) => [l.visible, l.castShadow, l.map, l.angle]);
      const place = (control: Partial<SimSnapshot['control']>, lightsOn = true): void =>
        visual.update(snapshotWith(TRUCK_IDS[0], TRAILER_IDS[0], control), {
          lights: lightsOn,
          hazard: false,
        });
      place({ gear: 'D' });
      const parked = rear.intensity;
      expect([rear.distance, rear.position.y]).toEqual([rearSpec.distance, rearSpec.position.z]);
      place({ gear: 'R' });
      expect([rear.distance, rear.position.y]).toEqual([work.distance, work.position.z]);
      expect(rear.intensity).toBeGreaterThan(parked);
      place({ gear: 'R' }, false);
      expect(rear.distance, 'no work light with the lights off').toBe(rearSpec.distance);
      place({ gear: 'R' });
      place({ gear: 'D' });
      expect(rear.distance).toBe(rearSpec.distance);
      expect(lights.map((l) => [l.visible, l.castShadow, l.map, l.angle])).toEqual(settled);
      visual.dispose();
    },
  );

  it.each(visuals)('switches the %s lights with the look, not the snapshot', (_name, make) => {
    const visual = make();
    const [, reversing] = STATES.map((c) => snapshotWith(TRUCK_IDS[0], TRAILER_IDS[0], c));
    for (const [preset, lighting, on] of [
      ['balanced', 'night', true],
      ['balanced', 'day', false],
      ['low', 'night', false],
      ['high', 'night', true],
      ['high', 'day', false],
    ] as const) {
      visual.setLook(lookFor(QUALITY_FLAGS[preset], lighting));
      visual.update(reversing as SimSnapshot);
      for (const l of spotsOf(visual.object)) expect(l.visible, `${preset} ${lighting}`).toBe(on);
    }
    visual.dispose();
  });

  it('lights the rear lights from the reversing and stop lamps, and the beam always at night', () => {
    const truck = proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env);
    truck.setLook(night('balanced'));
    const [front, rear] = spotsOf(truck.object);
    if (front === undefined || rear === undefined) throw new Error('no truck lights');
    const intensity = (control: Partial<SimSnapshot['control']>): number[] => {
      truck.update(snapshotWith(TRUCK_IDS[0], TRAILER_IDS[0], control));
      return [front.intensity, rear.intensity];
    };
    const parked = intensity({ gear: 'P', brake: false });
    const reversing = intensity({ gear: 'R', brake: false });
    const braking = intensity({ gear: 'P', brake: true });
    expect(parked[0]).toBeGreaterThan(0);
    expect(reversing[0]).toBe(parked[0]);
    expect(parked[1], 'the tail lamp').toBeGreaterThan(0);
    expect(reversing[1]).toBeGreaterThan(parked[1] ?? 0);
    expect(braking[1]).toBeGreaterThan(parked[1] ?? 0);
    truck.dispose();
  });

  it('darkens the beam and the tail light with the lights off, by intensity alone', () => {
    const truck = proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env);
    truck.setLook(night('balanced'));
    const [front, rear] = spotsOf(truck.object);
    if (front === undefined || rear === undefined) throw new Error('no truck lights');
    const snapshot = (control: Partial<SimSnapshot['control']>, lights: boolean): void =>
      truck.update(snapshotWith(TRUCK_IDS[0], TRAILER_IDS[0], control), {
        lights,
        hazard: false,
      });
    snapshot({ gear: 'P', brake: false }, false);
    expect([front.intensity, rear.intensity]).toEqual([0, 0]);
    snapshot({ gear: 'R', brake: false }, false);
    expect(rear.intensity, 'reversing stays automatic').toBeGreaterThan(0);
    snapshot({ gear: 'P', brake: true }, false);
    expect(rear.intensity, 'stop stays automatic').toBeGreaterThan(0);
    expect(front.intensity).toBe(0);
    expect(front.visible && rear.visible, 'the light set is untouched').toBe(true);
    snapshot({ gear: 'P', brake: false }, true);
    expect(front.intensity).toBeGreaterThan(0);
    truck.dispose();
  });

  const camera = (ids: readonly number[]): Layers => {
    const layers = new Layers();
    layers.set(DEFAULT_LAYER);
    enableLayers(layers, ids);
    return layers;
  };

  it('keeps every vehicle light on the top-down layer or on one every perspective camera sees', () => {
    const perspective = [COCKPIT_LAYERS, MIRROR_LAYERS, CHASE_LAYERS].map(camera);
    for (const [, make] of visuals) {
      const visual = make();
      for (const preset of ['high', 'balanced', 'low'] as const) {
        visual.setLook(lookFor(QUALITY_FLAGS[preset], 'night'));
        const lights = lightsOf(visual.object);
        expect(lights.length).toBeGreaterThan(0);
        for (const l of lights) {
          const aidsOnly = l.layers.mask === 1 << AIDS_LAYER;
          const everywhere = perspective.every((c) => (c.mask & l.layers.mask) === l.layers.mask);
          expect(aidsOnly || everywhere).toBe(true);
          expect(l.layers.mask).toBe(1 << PERSPECTIVE_LAYER);
        }
      }
      visual.dispose();
    }
  });
});

describe('lampLitSample', () => {
  it.each([true, false])(
    'is a graded surface under the spot light with the beam map, casting %s',
    (casting) => {
      const sample = lampLitSample(casting);
      expect(sample.lights).toHaveLength(1);
      const [light] = sample.lights ?? [];
      expect(light instanceof SpotLight && light.map !== null).toBe(true);
      expect(light?.castShadow).toBe(casting);
      expect(sample.mesh.receiveShadow).toBe(casting);
      sample.dispose();
    },
  );
});
