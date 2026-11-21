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
import { setGraded, type GradeSample } from './grade';
import { type Lamp, trailerLamps, truckLamps } from './lamp-layout';
import { type LampState } from './lamp-state';
import { PERSPECTIVE_LAYER } from './seams';

/*
 * The lamps' light at night: one SpotLight for the truck's dipped beams, one behind the truck and one
 * behind the trailer for the reversing and stop/tail lamps. No shadows: a surface the beam can
 * reach is lit through whatever stands in front of it. The lights are on the perspective layer, and
 * a look switches them on or off once; driving only changes their intensity and colour, so the
 * lit shaders never rebuild.
 */

const rad = (deg: number): number => (deg * Math.PI) / 180;

export type LampLightId = 'truck-front' | 'truck-rear' | 'trailer-rear';

export type LampLightSpec = {
  readonly id: LampLightId;
  /** In the body frame of the part that carries the light: x forward, y left, z up. */
  readonly position: Vec3;
  /** Unit vector of the cone's axis. */
  readonly aim: Vec3;
  /** Half angle of the cone, radians. */
  readonly angle: number;
  readonly penumbra: number;
  /** Where the light ends (m), reached from `position`. */
  readonly distance: number;
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
  trailerDistance: 12,
  /** Elevation (degrees below the horizon) down to which the trailer's light is at full strength; steeper rays fall with `falloff`, which puts the ground peak a few metres back. */
  hot: 11,
  falloff: 3.5,
} as const;

/**
 * Peak irradiance each lamp puts on the ground, in the units of `light-rig.ts`: the light's candela
 * follow from it and the lamps' height. Dipped beam, reversing and stop lamp (a lit tail lamp keeps
 * `TAIL_LEVEL` of the stop lamp's).
 */
export const GROUND = { dipped: 1.1, reversing: 1.2, stop: 0.8 } as const;

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

/** Metres from a truck's rear end to a trailer's front when the vehicles stand straight. */
export function drawbarGap(truck: TruckSpec, trailer: TrailerSpec): number {
  const t = truckAnchors(truck);
  const r = trailerAnchors(trailer);
  return t.rearX - (t.coupling.x - r.eye.x + r.frontX - r.turntable.x);
}

/** The truck's lights: the dipped beam ahead, and the reversing and stop lamps over the drawbar gap behind. */
export function truckLampLights(spec: TruckSpec): readonly LampLightSpec[] {
  const { lamps } = truckLamps(spec);
  const rear = placed(lamps.filter(has('reversing')), -1);
  const gap = Math.min(...trailers.map((t) => drawbarGap(spec, t)));
  return [
    {
      id: 'truck-front',
      position: placed(lamps.filter(has('dipped-beam')), 1),
      aim: aimOf(1, BEAM.pitch),
      angle: BEAM.angle,
      penumbra: BEAM.penumbra,
      distance: BEAM.distance,
    },
    {
      id: 'truck-rear',
      position: rear,
      aim: aimOf(-1, REAR.pitch),
      angle: REAR.angle,
      penumbra: REAR.penumbra,
      // ends before the trailer's front, which the light would otherwise reach through the gap
      distance: gap - (truckAnchors(spec).rearX - rear.x),
    },
  ];
}

export function trailerLampLight(spec: TrailerSpec): LampLightSpec {
  return {
    id: 'trailer-rear',
    position: placed(trailerLamps(spec, 'shell').lamps.filter(has('reversing')), -1),
    aim: aimOf(-1, REAR.trailerPitch),
    angle: REAR.angle,
    penumbra: REAR.penumbra,
    distance: REAR.trailerDistance,
  };
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

const patternOf = (id: LampLightId): Pattern | null =>
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

/** The candela that bring each lamp to its `GROUND` peak. */
export function candela(spec: LampLightSpec): Candela {
  const key = `${spec.id} ${spec.position.z} ${spec.distance}`;
  let known = candelas.get(key);
  if (known === undefined) {
    const perCandela = groundIrradiancePerCandela(spec);
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
  /** Switches the set on or off; it changes the scene's light set, so call it on a look change only. */
  setEnabled(on: boolean): void;
  /** Sets each light's intensity and colour from the lamps' levels; nothing else changes. */
  update(state: LampState): void;
  dispose(): void;
}

const toThree = ({ x, y, z }: Vec3, out = new Vector3()): Vector3 => out.set(x, z, -y);

/** Lights for `specs`, children of `parent`, whose frame is the specs' part. Off until `setEnabled`. */
export function createLampLights(specs: readonly LampLightSpec[], parent: Object3D): LampLights {
  const maps = specs.map((s) => {
    const pattern = patternOf(s.id);
    return pattern === null ? null : patternMap(pattern);
  });
  const cds = specs.map(candela);
  const lights = specs.map((spec, i) => {
    const light = new SpotLight(0xffffff, 0, spec.distance, spec.angle, spec.penumbra, 2);
    toThree(spec.position, light.position);
    const aim = toThree(spec.aim);
    light.target.position.copy(light.position).addScaledVector(aim, 10);
    light.map = maps[i] ?? null;
    light.shadow.camera.near = 0.05;
    light.layers.set(PERSPECTIVE_LAYER);
    light.visible = false;
    light.name = spec.id;
    // in the graph: three never updates the matrix of a target outside it
    parent.add(light, light.target);
    return light;
  });
  return {
    lights,
    setEnabled(on) {
      for (const light of lights) light.visible = on;
    },
    update(state) {
      specs.forEach((spec, i) => {
        const light = lights[i];
        const cd = cds[i];
        if (light === undefined || cd === undefined) return;
        light.intensity = emission(spec.id, cd, state, light.color);
      });
    },
    dispose() {
      for (const light of lights) light.dispose();
      for (const map of maps) map?.dispose();
    },
  };
}

/** Irradiance a light of `cd` candela puts on a surface facing it at `distance` (three's inverse-square with its cut-off window). */
export function facingIrradiance(cd: number, distance: number, reach: number): number {
  const window = Math.max(0, 1 - (distance / reach) ** 4) ** 2;
  return (cd * window) / Math.max(distance ** 2, 0.01);
}

/** Share of the peak the cone gives along a ray at `cosine` to the axis (three's spot attenuation). */
export function coneShare(spec: LampLightSpec, cosine: number): number {
  const outer = Math.cos(spec.angle);
  const inner = Math.cos(spec.angle * (1 - spec.penumbra));
  return smoothstep(outer, inner, cosine);
}

/** A ground point a light reaches, in the part's frame, with the irradiance there per candela of the light's peak. */
export type LitGround = { readonly x: number; readonly y: number; readonly irradiance: number };

/**
 * The ground under the light's cone, sampled over a `steps` grid of rays. Faces turned to the beam
 * are not counted: they clip, as a lit wall does at a headlamp's range.
 */
export function litGround(spec: LampLightSpec, steps = 120): LitGround[] {
  const axis = new Vector3(spec.aim.x, spec.aim.y, spec.aim.z);
  // the cone's frame as the shadow camera sees it: right and up for a viewer along the axis
  const right = new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize();
  const up = new Vector3().crossVectors(right, axis).normalize();
  const reach = Math.tan(spec.angle);
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
        irradiance: share * pattern * facingIrradiance(1, t, spec.distance) * -ray.z,
      });
    }
  }
  return out;
}

/** Peak irradiance per candela of the light's peak that the light puts on the ground. */
export function groundIrradiancePerCandela(spec: LampLightSpec, steps = 120): number {
  return Math.max(...litGround(spec, steps).map((p) => p.irradiance));
}

/** A graded Lambert surface under a spot light with the beam map: the program the lit views build at night. */
export function lampLitSample(): GradeSample {
  const geometry = new BoxGeometry();
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const material = new MeshLambertNodeMaterial({ vertexColors: true });
  setGraded(material, true);
  const map = patternMap(beamPattern);
  const light = new SpotLight(0xffffff, 1, BEAM.distance, BEAM.angle, BEAM.penumbra, 2);
  light.map = map;
  return {
    mesh: new Mesh(geometry, material),
    lights: [light],
    dispose: () => {
      light.dispose();
      map.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
