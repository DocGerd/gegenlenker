import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Box3,
  type BufferGeometry,
  DoubleSide,
  Layers,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Raycaster,
  SpotLight,
  Vector3,
} from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { setGradeDisabled } from './grade';
import {
  parseShell,
  parseTrailerShell,
  type Shell,
  type ShellKind,
  type Shells,
  type TrailerShell,
} from './glb-shells';
import { CASTING_LIGHTS, SHADOW_NEAR } from './lamp-light';
import { lookFor } from './look';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { enableLayers, SHADOW_CASTER_LAYERS, type VehicleVisual } from './seams';
import { isShadowCamera } from './sun-shadow';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const env = {
  attach: () => undefined,
  texture: () => null,
  onChange: () => () => undefined,
  reportApplied: () => undefined,
  setSky: () => undefined,
  dispose: () => undefined,
};

const glb = (key: string): ArrayBuffer => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${key}.glb`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const loaded = <S>(shell: S): Shells<S> => ({
  setEnabled: () => undefined,
  attached: () => undefined,
  onLoaded: (_key, apply) => {
    apply(shell);
    return () => undefined;
  },
});

const castingMask = ((): number => {
  const layers = new Layers();
  layers.disableAll();
  enableLayers(layers, SHADOW_CASTER_LAYERS);
  return layers.mask;
})();

const spots = (root: Object3D): SpotLight[] => {
  const out: SpotLight[] = [];
  root.traverse((o) => {
    if (o instanceof SpotLight) out.push(o);
  });
  return out;
};

const high = lookFor(QUALITY_FLAGS.high, 'night');
const casting = (visual: VehicleVisual): string[] =>
  spots(visual.object)
    .filter((l) => l.castShadow)
    .map((l) => l.name);

const snapshot = (control: Partial<SimSnapshot['control']>): SimSnapshot => {
  const sim = createSimulation(
    resolveCombination(truckById(TRUCK_IDS[0]), trailerById(TRAILER_IDS[0])),
    { truck: { x: 0, y: 0, heading: 0 } },
    () => null,
  );
  const first = sim.snapshot();
  return { ...first, control: { ...first.control, ...control } };
};

describe('which lamp lights cast', () => {
  afterEach(() => {
    setGradeDisabled(false);
  });

  const visuals = [
    ['truck', () => proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env)],
    ['trailer', () => proceduralTrailer(trailerById(TRAILER_IDS[0]), palette, undefined, env)],
  ] as const;

  it.each(visuals)(
    'lets the dipped beam and the trailer light cast on %s at High at night',
    (name, make) => {
      const visual = make();
      visual.setLook(high);
      expect(casting(visual)).toEqual(name === 'truck' ? ['truck-front'] : ['trailer-rear']);
      visual.dispose();
    },
  );

  it.each(visuals)('casts nowhere else on the %s: no other preset, no day', (_name, make) => {
    const visual = make();
    for (const [preset, lighting] of [
      ['balanced', 'night'],
      ['low', 'night'],
      ['high', 'day'],
      ['balanced', 'day'],
    ] as const) {
      visual.setLook(lookFor(QUALITY_FLAGS[preset], lighting));
      expect(casting(visual), `${preset} ${lighting}`).toEqual([]);
    }
    visual.dispose();
  });

  it('never lets the lights behind the truck cast', () => {
    expect(CASTING_LIGHTS).not.toContain('truck-rear');
    const truck = proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env);
    truck.setLook(high);
    const rear = spots(truck.object).find((l) => l.name === 'truck-rear');
    expect(rear?.castShadow).toBe(false);
    truck.dispose();
  });

  it('stops casting while the grade check has failed, and resumes after', () => {
    const truck = proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env);
    truck.setLook(high);
    setGradeDisabled(true);
    truck.update(snapshot({ gear: 'P' }));
    expect(casting(truck)).toEqual([]);
    setGradeDisabled(false);
    truck.update(snapshot({ gear: 'P' }));
    expect(casting(truck)).toEqual(['truck-front']);
    truck.dispose();
  });

  it('draws the shadow maps of the caster layers only, and counts them as shadow passes', () => {
    const truck = proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env);
    const trailer = proceduralTrailer(trailerById(TRAILER_IDS[0]), palette, undefined, env);
    for (const visual of [truck, trailer]) visual.setLook(high);
    const lit = [truck, trailer].flatMap((v) => spots(v.object).filter((l) => l.castShadow));
    expect(lit).toHaveLength(2);
    for (const light of lit) {
      expect(light.shadow.camera.layers.mask).toBe(castingMask);
      expect(isShadowCamera(light.shadow.camera)).toBe(true);
      expect(light.shadow.autoUpdate).toBe(false);
    }
    truck.dispose();
    trailer.dispose();
  });

  it('ends each shadow camera no further than its light reaches', () => {
    for (const make of [
      () => proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env),
      () => proceduralTrailer(trailerById(TRAILER_IDS[0]), palette, undefined, env),
    ]) {
      const visual = make();
      visual.setLook(high);
      for (const light of spots(visual.object).filter((l) => l.castShadow)) {
        light.shadow.updateMatrices(light);
        const { near, far } = light.shadow.camera;
        expect(far, light.name).toBeLessThanOrEqual(light.distance);
        expect(near, light.name).toBeLessThan(far);
      }
      visual.dispose();
    }
  });

  it('queues a map only while the lamp is lit, and keeps casting while it is dark', () => {
    const truck = proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env);
    truck.setLook(high);
    const front = spots(truck.object).find((l) => l.name === 'truck-front');
    if (front === undefined) throw new Error('no beam');
    front.shadow.needsUpdate = false;
    truck.update(snapshot({ gear: 'P' }), { lights: false, hazard: false });
    expect(front.intensity).toBe(0);
    expect(front.shadow.needsUpdate, 'dark').toBe(false);
    expect(front.castShadow, 'a dark lamp keeps its programs').toBe(true);
    truck.update(snapshot({ gear: 'P' }), { lights: true, hazard: false });
    expect(front.intensity).toBeGreaterThan(0);
    expect(front.shadow.needsUpdate, 'lit').toBe(true);
    truck.dispose();
  });

  it('keeps the shadows off the lights that are off with the look', () => {
    const truck = proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env);
    truck.setLook(high);
    truck.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    truck.update(snapshot({ gear: 'P' }));
    expect(casting(truck)).toEqual([]);
    for (const light of spots(truck.object)) expect(light.shadow.needsUpdate).toBe(false);
    truck.dispose();
  });
});

const ABOVE = 1e-4;

/** The nearest two-sided hit of the casters along `direction`: its distance and whether a back face was struck. */
function nearest(
  casters: readonly Mesh[],
  raycaster: Raycaster,
  from: Vector3,
  direction: Vector3,
): { distance: number; back: boolean } | null {
  raycaster.set(from, direction);
  const [first] = raycaster.intersectObjects([...casters], false);
  const face = first?.face;
  if (first === undefined || face === undefined || face === null || first.distance < ABOVE) {
    return null;
  }
  const normal = face.normal.clone().transformDirection(first.object.matrixWorld);
  return { distance: first.distance, back: normal.dot(direction) > 0 };
}

/** Rays through the light's cone: a grid over its tangent plane, those inside the cone angle only. */
function coneRays(light: SpotLight, steps = 14): Vector3[] {
  const from = light.getWorldPosition(new Vector3());
  const axis = light.target.getWorldPosition(new Vector3()).sub(from).normalize();
  const right = new Vector3().crossVectors(axis, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, axis).normalize();
  const reach = Math.tan(light.angle);
  const out: Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const ray = axis
        .clone()
        .addScaledVector(right, reach * (2 * (i / steps) - 1))
        .addScaledVector(up, reach * (2 * (j / steps) - 1))
        .normalize();
      if (ray.angleTo(axis) <= light.angle) out.push(ray);
    }
  }
  return out;
}

const castersOf = (visual: VehicleVisual): Mesh[] => {
  visual.object.updateMatrixWorld(true);
  const out: Mesh[] = [];
  visual.object.traverse((o) => {
    if (!(o instanceof Mesh) || !o.castShadow || (o.layers.mask & castingMask) === 0) return;
    for (let p: Object3D | null = o; p !== null; p = p.parent) if (!p.visible) return;
    // a clone with both faces, so the ray finds back faces too
    const clone = new Mesh<BufferGeometry, Material>(
      o.geometry as BufferGeometry,
      new MeshBasicMaterial({ side: DoubleSide }),
    );
    clone.matrixWorld.copy(o.matrixWorld);
    clone.matrixWorldAutoUpdate = false;
    out.push(clone);
  });
  return out;
};

const readShell = (id: TruckId, kind: ShellKind): Promise<Shell> =>
  parseShell(glb(`${id}-${kind}`), kind);
const readTrailer = (id: TrailerId): Promise<TrailerShell> =>
  parseTrailerShell(glb(`${id}-trailer`));

describe('a casting lamp light stands clear of what casts', () => {
  const check = (visual: VehicleVisual, label: string): void => {
    visual.setLook(high);
    const lights = spots(visual.object).filter((l) => l.castShadow);
    expect(lights.length, label).toBeGreaterThan(0);
    const meshes = castersOf(visual);
    expect(meshes.length, label).toBeGreaterThan(0);
    const raycaster = new Raycaster();
    // the casters are where the rays can find them: from above, the middle of their box is struck
    const middle = new Box3();
    for (const mesh of meshes) middle.expandByObject(mesh);
    const above = middle.getCenter(new Vector3());
    above.y = middle.max.y + 1;
    expect(nearest(meshes, raycaster, above, new Vector3(0, -1, 0)), label).not.toBeNull();
    for (const light of lights) {
      const from = light.getWorldPosition(new Vector3());
      let enclosed = 0;
      let inside = 0;
      for (const ray of coneRays(light)) {
        const found = nearest(meshes, raycaster, from, ray);
        if (found === null) continue;
        if (found.back) enclosed++;
        if (found.distance < SHADOW_NEAR) inside++;
      }
      expect(enclosed, `${label} ${light.name}: rays that start inside a caster`).toBe(0);
      expect(inside, `${label} ${light.name}: rays that meet a caster inside the near plane`).toBe(
        0,
      );
    }
  };

  it.each(TRUCK_IDS)('keeps the %s beam out of its own cab, bumper and body', async (id) => {
    const cab = await readShell(id, 'cab');
    const body = await readShell(id, 'body');
    const visual = proceduralTruck(
      truckById(id),
      palette,
      { cab: loaded(cab), body: loaded(body) },
      env,
    );
    check(visual, id);
    visual.dispose();
  });

  it.each(TRAILER_IDS)('keeps the %s trailer light out of its own body and ramps', async (id) => {
    const shell = await readTrailer(id);
    const visual = proceduralTrailer(trailerById(id), palette, loaded(shell), env);
    check(visual, id);
    visual.dispose();
  });
});
