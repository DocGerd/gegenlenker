import {
  BoxGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DataUtils,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  type Object3D,
  RGBAFormat,
  SpotLight,
  Vector3,
} from 'three';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import type { TrailerSpec, TruckSpec, Vec3 } from '../contracts/vehicle';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { trailers } from '../vehicles/registry';
import { gradeDisabled, setGraded, type GradeSample } from './grade';
import { type Lamp, trailerLamps, truckLamps } from './lamp-layout';
import { TRUCK_LOOKS } from './livery';
import { type LampState } from './lamp-state';
import { PERSPECTIVE_LAYER } from './seams';
import { prepareShadow, queueShadow } from './sun-shadow';

/*
 * The lamps' light at night: a SpotLight at each of the truck's dipped lamps, one behind the truck and one
 * behind the trailer for the reversing and stop/tail lamps. Without shadows a surface the beam can
 * reach is lit through whatever stands in front of it; where `LAMP_SHADOW` applies the beam and the
 * trailer's light cast. The lights are on the perspective layer, and a look switches them on or off
 * (and the casting) once; driving only changes their intensity and colour, so the lit shaders never rebuild.
 */

const rad = (deg: number): number => (deg * Math.PI) / 180;

export type LampLightId = 'truck-front' | 'truck-rear' | 'trailer-rear';

/** A spot's cone, in the frame of whatever carries it: what the ground analysis needs of a light. */
export type Cone = {
  /** x forward, y left, z up. */
  readonly position: Vec3;
  /** Unit vector of the cone's axis. */
  readonly aim: Vec3;
  /** Half angle of the cone, radians. */
  readonly angle: number;
  readonly penumbra: number;
  /** Where the light ends (m), reached from `position`. */
  readonly distance: number;
  /** Exponent of the fall-off with distance; 2 where absent, the inverse square. */
  readonly decay?: number;
};

/**
 * Positions are in the body frame of the part that carries the light. A rear light with `work` takes
 * that cone while the work floodlights shine: the light set stays the same, only its uniforms change.
 */
export type LampLightSpec = Cone & {
  readonly id: LampLightId;
  /** The side a lamp of a pair stands on, as seen looking along the vehicle's heading. */
  readonly side?: 'left' | 'right';
  readonly work?: Cone;
};

/** The dipped beam: asymmetric, with a cut-off, and shaped by `beamPattern`. */
export const BEAM = {
  angle: rad(32),
  penumbra: 0.4,
  /** Axis pitch below the horizon, radians. */
  pitch: rad(6),
  distance: 40,
  /** Cut-off elevation (degrees) on the side of oncoming traffic, and how far it rises on the kerb side. */
  cutLeft: -2,
  kick: 3,
  /** Degrees over which the cut-off is soft. */
  soft: 0.8,
  /** Elevation (degrees below the horizon) down to which the beam is at full strength; below it falls with this power of the angle. */
  hot: 2.5,
  falloff: 2.5,
  /** Gaussian width (degrees) of the sideways spread. */
  spread: 18,
} as const;

/** The lamps behind a vehicle throw a wide cone steeply down. */
export const REAR = {
  angle: rad(50),
  penumbra: 0.6,
  pitch: rad(35),
  /** The trailer's light is aimed flatter and reaches this far: nothing stands behind it but the yard. */
  trailerPitch: rad(22),
  /** The truck's work lamps, standing higher up, aim flatter so their pool reaches back to the trailer. */
  workPitch: rad(12),
  trailerDistance: 12,
  /** Elevation (degrees below the horizon) down to which the trailer's light is at full strength; steeper rays fall with `falloff`, which puts the ground peak a few metres back. */
  hot: 11,
  falloff: 3.5,
} as const;

/**
 * Peak irradiance each lamp puts on the ground, in the units of `light-rig.ts`: the light's candela
 * follow from it and the lamps' height. Dipped beam (of one light between the two lamps, which each
 * send out half of it), reversing and stop lamp (a lit tail lamp keeps `TAIL_LEVEL` of the stop lamp's).
 */
export const GROUND = { dipped: 1.1, reversing: 1.2, stop: 0.8 } as const;

/**
 * The lights that cast where the look allows it. The reversing lamps behind the truck light the
 * drawbar gap, which the trailer's own front would shade; they stay without a map.
 */
export const CASTING_LIGHTS: readonly LampLightId[] = ['truck-front', 'trailer-rear'];

/**
 * Shadow map of a casting lamp: its own size, and biases for a beam that grazes the ground. The
 * bias is in the shadow camera's perspective depth, where it reaches about `|bias| d² / near` metres
 * at distance d, so a shadow detaches from its caster by that much.
 */
export const LAMP_SHADOW = { mapSize: 1024, bias: -0.00005, normalBias: 0.04 } as const;

/** Nearest a caster may stand to a casting light (m); the shadow camera clips what is closer. */
export const SHADOW_NEAR = 0.5;

/** Near plane of a light that does not cast, which only projects its map. */
const MAP_NEAR = 0.05;

/** A light stands this far outside its lenses, so it does not light the housing it sits in. */
const STANDOFF = 0.03;

/** Lit colour of the lamp lenses (lamp-lens.ts), linear. */
const WHITE = new Color('#fff6e8');
const RED = new Color('#ff1408');

const centre = (a: number, b: number): number => (a + b) / 2;

function placed(lamps: readonly Lamp[], side: 1 | -1): Vec3 {
  if (lamps.length === 0) throw new Error('lampLights: no lamps to place a light at');
  const mean = (pick: (l: Lamp) => number): number =>
    lamps.reduce((sum, l) => sum + pick(l), 0) / lamps.length;
  const x =
    side > 0
      ? Math.max(...lamps.map((l) => l.box[0][1])) + STANDOFF
      : Math.min(...lamps.map((l) => l.box[0][0])) - STANDOFF;
  return {
    x,
    y: mean((l) => centre(...l.box[1])),
    z: mean((l) => centre(...l.box[2])),
  };
}

const aimOf = (side: 1 | -1, pitch: number): Vec3 => ({
  x: side * Math.cos(pitch),
  y: 0,
  z: -Math.sin(pitch),
});

const has = (fn: Lamp['fns'][number]) => (l: Lamp) => l.fns.includes(fn);

/** Share of its peak a work pool still has where it should end: three's distance window fades towards the cut-off. */
const WORK_END_SHARE = 0.02;

/**
 * The cone of `light` moved to the work lamps in `lamps`, or none where it has no work lamps. The
 * cone's `distance` is a ray length from a lamp high up, so it is set from where the pool should end
 * on the ground, `groundEnd` (x, behind the lamps), which is where the window is down to `WORK_END_SHARE`.
 */
function withWork(
  light: LampLightSpec,
  lamps: readonly Lamp[],
  groundEnd: number,
  aim = light.aim,
): LampLightSpec {
  const work = lamps.filter(has('work'));
  if (work.length === 0) return light;
  const position = placed(work, -1);
  const windowAtEnd = (1 - Math.sqrt(WORK_END_SHARE)) ** 0.25;
  const distance = Math.hypot(position.x - groundEnd, position.z) / windowAtEnd;
  return { ...light, work: { ...light, position, aim, distance } };
}

/** The x on the ground where `light`'s cone ends, behind it. */
const groundEnd = ({ position, distance }: Cone): number =>
  position.x - Math.sqrt(distance ** 2 - position.z ** 2);

/** Metres from a truck's rear end to a trailer's front when the vehicles stand straight. */
export function drawbarGap(truck: TruckSpec, trailer: TrailerSpec): number {
  const t = truckAnchors(truck);
  const r = trailerAnchors(trailer);
  return t.rearX - (t.coupling.x - r.eye.x + r.frontX - r.turntable.x);
}

/** The truck's lights: the dipped beam ahead, and the reversing and stop lamps over the drawbar gap behind. */
export function truckLampLights(spec: TruckSpec): readonly LampLightSpec[] {
  const { lamps } = truckLamps(spec, TRUCK_LOOKS[spec.id].cab.length);
  const rear = placed(lamps.filter(has('reversing')), -1);
  const gap = Math.min(...trailers.map((t) => drawbarGap(spec, t)));
  const rearX = truckAnchors(spec).rearX;
  const dipped = lamps
    .filter(has('dipped-beam'))
    .map((lamp): LampLightSpec => {
      const position = placed([lamp], 1);
      return {
        id: 'truck-front',
        side: position.y > 0 ? 'left' : 'right',
        position,
        aim: aimOf(1, BEAM.pitch),
        angle: BEAM.angle,
        penumbra: BEAM.penumbra,
        distance: BEAM.distance,
      };
    })
    .sort((a, b) => b.position.y - a.position.y);
  return [
    ...dipped,
    withWork(
      {
        id: 'truck-rear',
        position: rear,
        aim: aimOf(-1, REAR.pitch),
        angle: REAR.angle,
        penumbra: REAR.penumbra,
        // ends before the trailer's front, which the light would otherwise reach through the gap
        distance: gap - (rearX - rear.x),
      },
      lamps,
      // the work pool runs back to the trailer's front and fades out there
      rearX - gap,
      aimOf(-1, REAR.workPitch),
    ),
  ];
}

export function trailerLampLight(spec: TrailerSpec): LampLightSpec {
  const { lamps } = trailerLamps(spec, 'shell');
  const light: LampLightSpec = {
    id: 'trailer-rear',
    position: placed(lamps.filter(has('reversing')), -1),
    aim: aimOf(-1, REAR.trailerPitch),
    angle: REAR.angle,
    penumbra: REAR.penumbra,
    distance: REAR.trailerDistance,
  };
  // the work pool ends where the reversing one does
  return withWork(light, lamps, groundEnd(light));
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Elevation above the horizon and azimuth to the right of the heading (degrees) of the ray through map point (u, v) of a cone. */
function rayAt(
  u: number,
  v: number,
  { angle, pitch }: { readonly angle: number; readonly pitch: number },
): { elevation: number; azimuth: number } {
  const reach = Math.tan(angle);
  const right = (2 * u - 1) * reach;
  const up = (2 * v - 1) * reach;
  const forward = Math.cos(pitch) + up * Math.sin(pitch);
  const height = -Math.sin(pitch) + up * Math.cos(pitch);
  return {
    elevation: (Math.atan2(height, Math.hypot(forward, right)) * 180) / Math.PI,
    azimuth: (Math.atan2(right, forward) * 180) / Math.PI,
  };
}

/**
 * The dipped beam's share (0 to 1) of its peak towards map point (u, v), where u runs right and v up
 * as the light sees it. Right-hand traffic: the cut-off sits low on the left and rises on the kerb
 * side; below it the intensity falls steeply with the angle, so the pool is brightest near the lamp and fades out.
 */
export function beamPattern(u: number, v: number): number {
  const { elevation, azimuth } = rayAt(u, v, BEAM);
  const cut = BEAM.cutLeft + BEAM.kick * smoothstep(0, 6, azimuth);
  const lit = 1 - smoothstep(cut - BEAM.soft, cut, elevation);
  const reach = Math.max(BEAM.hot, -elevation) / BEAM.hot;
  return (lit * Math.exp(-0.5 * (azimuth / BEAM.spread) ** 2)) / reach ** BEAM.falloff;
}

/** The trailer light's share of its peak: full down to `REAR.hot` below the horizon, then dimming, so the peak is not under the lamp. */
export function trailerPattern(u: number, v: number): number {
  const { elevation } = rayAt(u, v, { angle: REAR.angle, pitch: REAR.trailerPitch });
  return (REAR.hot / Math.max(REAR.hot, -elevation)) ** REAR.falloff;
}

type Pattern = (u: number, v: number) => number;

const patternOf = (id: LampLightId | undefined): Pattern | null =>
  id === 'truck-front' ? beamPattern : id === 'trailer-rear' ? trailerPattern : null;

const MAP_SIZE = 64;

/** `pattern` as a spot light's map: linear data, half floats so the steep fall-off does not band. */
export function patternMap(pattern: Pattern): DataTexture {
  const data = new Uint16Array(MAP_SIZE * MAP_SIZE * 4);
  const one = DataUtils.toHalfFloat(1);
  for (let j = 0; j < MAP_SIZE; j++) {
    for (let i = 0; i < MAP_SIZE; i++) {
      const f = DataUtils.toHalfFloat(pattern((i + 0.5) / MAP_SIZE, (j + 0.5) / MAP_SIZE));
      data.set([f, f, f, one], (j * MAP_SIZE + i) * 4);
    }
  }
  const map = new DataTexture(data, MAP_SIZE, MAP_SIZE, RGBAFormat, HalfFloatType);
  map.minFilter = LinearFilter;
  map.magFilter = LinearFilter;
  map.wrapS = ClampToEdgeWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  return map;
}

type Candela = { readonly white: number; readonly red: number };

const candelas = new Map<string, Candela>();

/**
 * The candela that bring each lamp to its `GROUND` peak; a lamp of a pair (`side`) takes half of a
 * light centred between the two, so the pair sends out as much. With `work`, as the light stands on
 * the work floodlights' cone.
 */
export function candela(spec: LampLightSpec, work = false): Candela {
  const cone = work && spec.work !== undefined ? { ...spec, ...spec.work } : spec;
  const pair = spec.side !== undefined;
  const key = `${spec.id} ${String(pair)} ${cone.position.z} ${cone.distance} ${cone.position.x}`;
  let known = candelas.get(key);
  if (known === undefined) {
    const perCandela = pair
      ? 2 * groundIrradiancePerCandela({ ...cone, position: { ...cone.position, y: 0 } })
      : groundIrradiancePerCandela(cone);
    known =
      spec.id === 'truck-front'
        ? { white: GROUND.dipped / perCandela, red: 0 }
        : { white: GROUND.reversing / perCandela, red: GROUND.stop / perCandela };
    candelas.set(key, known);
  }
  return known;
}

/** Writes the lamps' colour for `spec` into `out` and returns the candela. */
function emission(
  id: LampLightId,
  { white: whiteCd, red: redCd }: Candela,
  { levels }: LampState,
  out: Color,
): number {
  if (id === 'truck-front') {
    out.copy(WHITE);
    return whiteCd * levels['dipped-beam'];
  }
  const white = whiteCd * levels.reversing;
  const red = redCd * Math.max(levels['rear-position'], levels.stop);
  const cd = white + red;
  if (cd === 0) return 0;
  out.setRGB(
    (WHITE.r * white + RED.r * red) / cd,
    (WHITE.g * white + RED.g * red) / cd,
    (WHITE.b * white + RED.b * red) / cd,
  );
  return cd;
}

export interface LampLights {
  readonly lights: readonly SpotLight[];
  /**
   * Switches the set on or off, and with `shadow` the casting lights' shadows; both change the
   * scene's light set, so call it on a look change only.
   */
  setEnabled(on: boolean, shadow?: boolean): void;
  /**
   * Sets each light's intensity and colour from the lamps' levels, and queues a casting light's map
   * while it shines; a failed grade check stops the casting, as it does the sun's.
   */
  update(state: LampState): void;
  dispose(): void;
}

const toThree = ({ x, y, z }: Vec3, out = new Vector3()): Vector3 => out.set(x, z, -y);

/** Puts `light` on `cone`; the light stays in its set, only its uniforms (and its shadow camera's) follow. */
function shape(light: SpotLight, cone: Cone): void {
  toThree(cone.position, light.position);
  light.target.position.copy(light.position).addScaledVector(toThree(cone.aim), 10);
  light.angle = cone.angle;
  light.penumbra = cone.penumbra;
  light.distance = cone.distance;
}

const pairLamps = new WeakSet<Object3D>();

/** Whether `light` stands for one lamp of a pair (`LampLightSpec.side`). */
export const isPairLamp = (light: Object3D): boolean => pairLamps.has(light);

/** Lights for `specs`, children of `parent`, whose frame is the specs' part. Off until `setEnabled`. */
export function createLampLights(specs: readonly LampLightSpec[], parent: Object3D): LampLights {
  // lights with one pattern share its map: three declares one sampler per distinct texture
  const shared = new Map<Pattern, DataTexture>();
  const maps = specs.map((s) => {
    const pattern = patternOf(s.id);
    if (pattern === null) return null;
    const known = shared.get(pattern) ?? patternMap(pattern);
    shared.set(pattern, known);
    return known;
  });
  const cds = specs.map((s) => candela(s));
  const workCds = specs.map((s) => (s.work === undefined ? null : candela(s, true)));
  const lights = specs.map((spec, i) => {
    const light = new SpotLight(0xffffff, 0, spec.distance, spec.angle, spec.penumbra, 2);
    shape(light, spec);
    light.map = maps[i] ?? null;
    if (CASTING_LIGHTS.includes(spec.id)) {
      prepareShadow(light, LAMP_SHADOW.mapSize);
      light.shadow.bias = LAMP_SHADOW.bias;
      light.shadow.normalBias = LAMP_SHADOW.normalBias;
    }
    light.shadow.camera.near = MAP_NEAR;
    light.layers.set(PERSPECTIVE_LAYER);
    light.visible = false;
    light.name = spec.side === undefined ? spec.id : `${spec.id}-${spec.side}`;
    if (spec.side !== undefined) pairLamps.add(light);
    // in the graph: three never updates the matrix of a target outside it
    parent.add(light, light.target);
    return light;
  });
  let wanted = false;
  const working = specs.map(() => false);
  const setCasting = (): void => {
    specs.forEach((spec, i) => {
      const light = lights[i];
      if (light !== undefined && CASTING_LIGHTS.includes(spec.id)) {
        light.castShadow = wanted && !gradeDisabled();
        // the map's projection does not depend on near; only a shadow wants the depth range
        light.shadow.camera.near = light.castShadow ? SHADOW_NEAR : MAP_NEAR;
      }
    });
  };
  return {
    lights,
    setEnabled(on, shadow = false) {
      for (const light of lights) light.visible = on;
      wanted = on && shadow;
      setCasting();
    },
    update(state) {
      setCasting();
      specs.forEach((spec, i) => {
        const light = lights[i];
        const cone = state.levels.work > 0 ? spec.work : undefined;
        const cd = cone === undefined ? cds[i] : workCds[i];
        if (light === undefined || cd === undefined || cd === null) return;
        if ((cone !== undefined) !== working[i]) {
          working[i] = cone !== undefined;
          shape(light, cone ?? spec);
        }
        light.intensity = emission(spec.id, cd, state, light.color);
        // a dark lamp skips its pass and keeps castShadow: flipping it rebuilds every lit program
        if (light.intensity > 0) queueShadow(light);
      });
    },
    dispose() {
      for (const light of lights) light.dispose();
      for (const map of shared.values()) map.dispose();
    },
  };
}

/** Irradiance a light of `cd` candela puts on a surface facing it at `distance` (three's fall-off with its cut-off window; the inverse square unless `decay` says otherwise). */
export function facingIrradiance(cd: number, distance: number, reach: number, decay = 2): number {
  const window = Math.max(0, 1 - (distance / reach) ** 4) ** 2;
  return (cd * window) / Math.max(distance ** decay, 0.01);
}

/** Share of the peak the cone gives along a ray at `cosine` to the axis (three's spot attenuation). */
export function coneShare(spec: Cone, cosine: number): number {
  const outer = Math.cos(spec.angle);
  const inner = Math.cos(spec.angle * (1 - spec.penumbra));
  return smoothstep(outer, inner, cosine);
}

/** A ground point a light reaches, in the part's frame, with the irradiance there per candela of the light's peak. */
export type LitGround = { readonly x: number; readonly y: number; readonly irradiance: number };

type GroundCone = Cone & { readonly id?: LampLightId };

/** The cone's frame as the shadow camera sees it: right and up for a viewer along the axis. */
function coneFrame(spec: Cone) {
  const axis = new Vector3(spec.aim.x, spec.aim.y, spec.aim.z);
  const right = new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize();
  const up = new Vector3().crossVectors(right, axis).normalize();
  return { axis, right, up, reach: Math.tan(spec.angle) };
}

/**
 * The ground under the light's cone, sampled over a `steps` grid of rays. Faces turned to the beam
 * are not counted: they clip, as a lit wall does at a headlamp's range.
 */
export function litGround(spec: GroundCone, steps = 120): LitGround[] {
  const { axis, right, up, reach } = coneFrame(spec);
  const ray = new Vector3();
  const out: LitGround[] = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      ray
        .copy(axis)
        .addScaledVector(right, reach * (2 * (i / steps) - 1))
        .addScaledVector(up, reach * (2 * (j / steps) - 1))
        .normalize();
      if (ray.z >= 0) continue;
      const share = coneShare(spec, ray.dot(axis));
      const pattern = patternOf(spec.id)?.(i / steps, j / steps) ?? 1;
      if (share * pattern === 0) continue;
      const t = spec.position.z / -ray.z;
      out.push({
        x: spec.position.x + t * ray.x,
        y: spec.position.y + t * ray.y,
        irradiance: share * pattern * facingIrradiance(1, t, spec.distance, spec.decay) * -ray.z,
      });
    }
  }
  return out;
}

/** Irradiance per candela of the light's peak that the light puts on the ground at (x, y): `litGround`'s value at the ray through there. */
export function irradianceAt(spec: GroundCone, x: number, y: number): number {
  const { axis, right, up, reach } = coneFrame(spec);
  const ray = new Vector3(x - spec.position.x, y - spec.position.y, -spec.position.z);
  const t = ray.length();
  ray.divideScalar(t);
  const along = ray.dot(axis);
  if (along <= 0) return 0;
  const u = (ray.dot(right) / along / reach + 1) / 2;
  const v = (ray.dot(up) / along / reach + 1) / 2;
  const pattern = patternOf(spec.id)?.(u, v) ?? 1;
  return (
    coneShare(spec, along) * pattern * facingIrradiance(1, t, spec.distance, spec.decay) * -ray.z
  );
}

/** Peak irradiance per candela of the light's peak that the light puts on the ground. */
export function groundIrradiancePerCandela(spec: GroundCone, steps = 120): number {
  return Math.max(...litGround(spec, steps).map((p) => p.irradiance));
}

/** The lights High has in the set at night: each lamp light as built, with the map and shadow a casting one carries. */
export function sampleLampLights(): { readonly lights: readonly SpotLight[]; dispose(): void } {
  const beamMap = patternMap(beamPattern);
  const trailerMap = patternMap(trailerPattern);
  const make = (
    id: LampLightId,
    cone: typeof BEAM | typeof REAR,
    distance: number,
    map: DataTexture | null,
  ): SpotLight => {
    const light = new SpotLight(0xffffff, 1, distance, cone.angle, cone.penumbra, 2);
    light.map = map;
    light.castShadow = CASTING_LIGHTS.includes(id);
    return light;
  };
  const lights = [
    make('truck-front', BEAM, BEAM.distance, beamMap),
    make('truck-front', BEAM, BEAM.distance, beamMap),
    make('truck-rear', REAR, REAR.trailerDistance, null),
    make('trailer-rear', REAR, REAR.trailerDistance, trailerMap),
  ];
  return {
    lights,
    dispose: () => {
      for (const light of lights) light.dispose();
      beamMap.dispose();
      trailerMap.dispose();
    },
  };
}

/**
 * A graded Lambert surface under the two dipped beams with their shared map: the program the lit views build at night.
 * With `casting` it is a shadow receiver under the casting beam, as at High; without, as at Balanced and Low.
 */
export function lampLitSample(casting = false): GradeSample {
  const geometry = new BoxGeometry();
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const material = new MeshLambertNodeMaterial({ vertexColors: true });
  setGraded(material, true);
  const map = patternMap(beamPattern);
  // the two dipped lamps share one map
  const lights = [0, 1].map(() => {
    const light = new SpotLight(0xffffff, 1, BEAM.distance, BEAM.angle, BEAM.penumbra, 2);
    light.map = map;
    light.castShadow = casting;
    return light;
  });
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = casting;
  return {
    mesh,
    lights,
    dispose: () => {
      for (const light of lights) light.dispose();
      map.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
