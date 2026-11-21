import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  SpotLight,
  Vector3,
} from 'three';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import type { Fixture, ResolvedLayout } from '../contracts/layout';
import type { ScenePalette } from '../contracts/render';
import type { Vec3 } from '../contracts/vehicle';
import { gradeDisabled, setGraded, type GradeSample } from './grade';
import { type Cone, coneShare, facingIrradiance, groundIrradiancePerCandela } from './lamp-light';
import type { Look } from './look';
import { PERSPECTIVE_LAYER, YARD_CASTER_LAYER } from './seams';
import { prepareShadow, queueShadow } from './sun-shadow';

/*
 * The yard's lamps at night: a floodlight mast throws a pool on the yard and a street lamp one on
 * the road, both from one analytic spot spec. The High preset lights the masts with real
 * SpotLights; the pools of Balanced and of the street lamps are the same spec baked into an
 * additive ground decal, so no light joins the set there. All of it is perspective only and drawn
 * at night; the lamps' lights stay on whatever the vehicles' lamps do. Where the preset allows it,
 * two masts also cast the yard's props into a map rendered once per look, kit load or restored context.
 */

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** The flood fixtures' light and head, which `yard-props.ts` draws. */
export const FLOOD = {
  /** Neutral LED. */
  colour: '#f4f8ff',
  angle: rad(35),
  penumbra: 0.8,
  distance: 100,
  /** A flat-field luminaire: its pattern keeps the field even, so the light does not fall off with distance within its reach. */
  decay: 0,
  /** Metres from the mast, towards the fixture's aim, where the axis meets the ground. */
  throw: 35,
  /** Highest irradiance one mast puts on the ground, in the units of `light-rig.ts`. */
  peak: 0.25,
  /** Of the head's lens centre: metres along the mast's aim from its axis, and below its top. */
  head: { forward: 0.46, below: 0.5 },
  /** Share of the lens colour the head glows with. */
  glow: 1.5,
} as const;

/**
 * The masts that cast and their shadow maps. Each shadow adds a sampler to every lit receiver, so
 * `casting` is bounded by the PBR ground's headroom (`pbrGroundNightSample`). The bias is in the
 * shadow camera's perspective depth (see `LAMP_SHADOW`).
 */
export const FLOOD_SHADOW = {
  casting: 2,
  mapSize: 2048,
  bias: -0.00005,
  normalBias: 0.08,
} as const;

export const STREET = {
  /** Warm, as sodium and warm-white LED street lamps are. */
  colour: '#ffbe78',
  angle: rad(40),
  penumbra: 0.7,
  /** Axis pitch below the horizon, towards the fixture's aim, radians. */
  pitch: rad(65),
  distance: 25,
  peak: 0.35,
  head: { forward: 1.1, below: 0.34 },
  glow: 1.5,
} as const;

/** Linear colour a fixture's head glows with: the light's, at `glow` of full. */
export function headGlow(kind: Fixture['kind']): [number, number, number] {
  const { colour, glow } = kind === 'flood' ? FLOOD : STREET;
  const c = new Color(colour);
  return [c.r * glow, c.g * glow, c.b * glow];
}

/** Where the pools' decals lie: above the markings and the contact blobs. */
const POOL_LIFT = 0.024;
/** Rays across a cone, each way, the baked pool is sampled at. */
const POOL_STEPS = 24;

export type YardLightSpec = Cone & {
  readonly kind: Fixture['kind'];
  readonly colour: Color;
  /** Highest irradiance the light puts on the ground. */
  readonly peak: number;
  /** The mast or lamp post, in the sim plane. */
  readonly post: { readonly x: number; readonly y: number };
};

type Post = { readonly x: number; readonly y: number; readonly height: number };

const unit = ({ x, y, z }: Vec3): Vec3 => {
  const n = Math.hypot(x, y, z);
  return { x: x / n, y: y / n, z: z / n };
};

/** The head lens centre of a fixture on `post`: along its aim from the axis, `below` the top. */
export function headPosition(post: Post, fixture: Fixture): Vec3 {
  const { forward, below } = fixture.kind === 'flood' ? FLOOD.head : STREET.head;
  const heading = Math.atan2(fixture.aim.y - post.y, fixture.aim.x - post.x);
  return {
    x: post.x + forward * Math.cos(heading),
    y: post.y + forward * Math.sin(heading),
    z: post.height - below,
  };
}

export function yardLightSpec(post: Post, fixture: Fixture): YardLightSpec {
  const position = headPosition(post, fixture);
  const toAim = { x: fixture.aim.x - position.x, y: fixture.aim.y - position.y };
  const reach = Math.hypot(toAim.x, toAim.y);
  const base = { post: { x: post.x, y: post.y }, position, kind: fixture.kind } as const;
  if (fixture.kind === 'flood') {
    return {
      ...base,
      aim: unit({
        x: (toAim.x / reach) * Math.min(FLOOD.throw, reach),
        y: (toAim.y / reach) * Math.min(FLOOD.throw, reach),
        z: -position.z,
      }),
      angle: FLOOD.angle,
      penumbra: FLOOD.penumbra,
      distance: FLOOD.distance,
      decay: FLOOD.decay,
      colour: new Color(FLOOD.colour),
      peak: FLOOD.peak,
    };
  }
  return {
    ...base,
    aim: {
      x: (toAim.x / reach) * Math.cos(STREET.pitch),
      y: (toAim.y / reach) * Math.cos(STREET.pitch),
      z: -Math.sin(STREET.pitch),
    },
    angle: STREET.angle,
    penumbra: STREET.penumbra,
    distance: STREET.distance,
    colour: new Color(STREET.colour),
    peak: STREET.peak,
  };
}

/** One spec per lamp fixture of `layout`, in the layout's order. */
export function yardLightSpecs(layout: Pick<ResolvedLayout, 'props'>): YardLightSpec[] {
  const out: YardLightSpec[] = [];
  for (const prop of layout.props) {
    const [post] = prop.colliders;
    if (prop.asset !== 'lamp' || prop.fixture === undefined || post === undefined) continue;
    out.push(yardLightSpec({ x: post.obb.cx, y: post.obb.cy, height: post.height }, prop.fixture));
  }
  return out;
}

/**
 * The masts that cast: the `FLOOD_SHADOW.casting` nearest the yard's entrance, from the layout's
 * fixtures alone so the shadows never hint at an exercise.
 */
export function castingMasts(floods: readonly YardLightSpec[]): YardLightSpec[] {
  return [...floods]
    .sort((a, b) => a.post.y - b.post.y || a.post.x - b.post.x)
    .slice(0, FLOOD_SHADOW.casting);
}

const candelas = new Map<string, number>();

/** The candela that bring the light to its `peak` on the ground. */
export function yardCandela(spec: YardLightSpec): number {
  const { position: p, aim: a } = spec;
  const key = [
    spec.kind,
    p.z,
    a.x,
    a.y,
    a.z,
    spec.angle,
    spec.penumbra,
    spec.distance,
    spec.decay,
  ].join();
  let known = candelas.get(key);
  if (known === undefined) {
    known = spec.peak / groundIrradiancePerCandela(spec);
    candelas.set(key, known);
  }
  return known;
}

/** Irradiance the light puts on the ground at sim point (`x`, `y`), the way three's spot light does. */
export function groundIrradiance(spec: YardLightSpec, x: number, y: number): number {
  const { position: p, aim } = spec;
  const to = new Vector3(x - p.x, y - p.y, -p.z);
  const t = to.length();
  const share = coneShare(spec, to.dot(new Vector3(aim.x, aim.y, aim.z)) / t);
  return yardCandela(spec) * share * facingIrradiance(1, t, spec.distance, spec.decay) * (p.z / t);
}

/** Irradiance the light puts on a face at sim point `at` with unit `normal`, as three's spot light does; zero on the far side. */
export function faceIrradiance(spec: YardLightSpec, at: Vec3, normal: Vec3): number {
  const { position: p, aim } = spec;
  const to = new Vector3(at.x - p.x, at.y - p.y, at.z - p.z);
  const t = to.length();
  const share = coneShare(spec, to.dot(new Vector3(aim.x, aim.y, aim.z)) / t);
  const facing = -(to.dot(new Vector3(normal.x, normal.y, normal.z)) / t);
  return Math.max(
    0,
    yardCandela(spec) * share * facingIrradiance(1, t, spec.distance, spec.decay) * facing,
  );
}

/** Linear luminance of a token: the albedo a baked pool is lit as. */
const albedo = (hex: number): number => {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

type Pool = { readonly spec: YardLightSpec; readonly albedo: number };

/**
 * The ground pools of `pools`, merged: a grid of rays across each cone, each vertex on the ground
 * where its ray lands, coloured with the light's colour times the radiance the ground's albedo
 * gives back (irradiance over pi). A ray that misses the ground or ends before it lands at the
 * light's reach, black.
 */
export function poolGeometry(pools: readonly Pool[], lift = POOL_LIFT): BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const index: number[] = [];
  const stride = POOL_STEPS + 1;
  const ray = new Vector3();
  for (const { spec, albedo: reflectance } of pools) {
    const axis = new Vector3(spec.aim.x, spec.aim.y, spec.aim.z);
    const right = new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize();
    const up = new Vector3().crossVectors(right, axis).normalize();
    const reach = Math.tan(spec.angle);
    const first = positions.length / 3;
    const { position: p } = spec;
    for (let i = 0; i <= POOL_STEPS; i++) {
      for (let j = 0; j <= POOL_STEPS; j++) {
        ray
          .copy(axis)
          .addScaledVector(right, reach * (2 * (i / POOL_STEPS) - 1))
          .addScaledVector(up, reach * (2 * (j / POOL_STEPS) - 1))
          .normalize();
        const t = ray.z < 0 ? p.z / -ray.z : Infinity;
        let x: number;
        let y: number;
        let level = 0;
        if (t < spec.distance) {
          x = p.x + t * ray.x;
          y = p.y + t * ray.y;
          level = (groundIrradiance(spec, x, y) / Math.PI) * reflectance;
        } else {
          // out of reach: where the reach ends on the ground along this ray's heading
          const out = Math.sqrt(Math.max(0, spec.distance ** 2 - p.z ** 2));
          const flat = Math.hypot(ray.x, ray.y);
          x = p.x + (ray.x / flat) * out;
          y = p.y + (ray.y / flat) * out;
        }
        positions.push(x, lift, -y);
        colours.push(spec.colour.r * level, spec.colour.g * level, spec.colour.b * level);
      }
    }
    for (let i = 0; i < POOL_STEPS; i++) {
      for (let j = 0; j < POOL_STEPS; j++) {
        const a = first + i * stride + j;
        index.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
      }
    }
  }
  return new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('color', new Float32BufferAttribute(colours, 3))
    .setIndex(index);
}

export interface YardLights {
  readonly object: Group;
  /** The masts' SpotLights; in the light set only while the look lights them. */
  readonly lights: readonly SpotLight[];
  /** The masts that cast, once the look and the grade allow it. */
  readonly casting: readonly SpotLight[];
  /** Shows the pools and switches the lights and their shadows; it changes the light set, so call it on a look change only. */
  setLook(look: Look): void;
  /** Stops the casting while the grade check has failed, as the sun does; once per frame. */
  update(): void;
  /** Redraws the casting masts' maps at the next render, after a caster has appeared or gone. */
  queueShadows(): void;
  dispose(): void;
}

const toThree = ({ x, y, z }: Vec3, out = new Vector3()): Vector3 => out.set(x, z, -y);

function poolMesh(pools: readonly Pool[], material: MeshBasicMaterial, name: string): Mesh | null {
  if (pools.length === 0) return null;
  const mesh = new Mesh(poolGeometry(pools), material);
  mesh.layers.set(PERSPECTIVE_LAYER);
  mesh.visible = false;
  mesh.name = name;
  return mesh;
}

export const FLOOD_POOL_NAME = 'flood-pool';
export const STREET_POOL_NAME = 'street-pool';

export function createYardLights(layout: ResolvedLayout, palette: ScenePalette): YardLights {
  const specs = yardLightSpecs(layout);
  const floods = specs.filter((s) => s.kind === 'flood');
  const streets = specs.filter((s) => s.kind === 'street');
  const object = new Group();
  const casters = new Set(castingMasts(floods));
  const casting: SpotLight[] = [];
  const lights = floods.map((spec) => {
    const light = new SpotLight(
      spec.colour,
      yardCandela(spec),
      spec.distance,
      spec.angle,
      spec.penumbra,
      spec.decay,
    );
    toThree(spec.position, light.position);
    light.target.position.copy(light.position).addScaledVector(toThree(spec.aim), 10);
    if (casters.has(spec)) {
      prepareShadow(light, FLOOD_SHADOW.mapSize, [YARD_CASTER_LAYER]);
      light.shadow.bias = FLOOD_SHADOW.bias;
      light.shadow.normalBias = FLOOD_SHADOW.normalBias;
      casting.push(light);
    }
    light.layers.set(PERSPECTIVE_LAYER);
    light.visible = false;
    light.name = 'yard-flood';
    // in the graph: three never updates the matrix of a target outside it
    object.add(light, light.target);
    return light;
  });
  let shadowWanted = false;
  const applyCasting = (): void => {
    const on = shadowWanted && !gradeDisabled();
    for (const light of casting) {
      light.castShadow = on;
      queueShadow(light);
    }
  };
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    forceSinglePass: true,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  });
  const yard = albedo(palette.yard);
  const road = albedo(palette.street);
  const floodPool = poolMesh(
    floods.map((spec) => ({ spec, albedo: yard })),
    material,
    FLOOD_POOL_NAME,
  );
  const streetPool = poolMesh(
    streets.map((spec) => ({ spec, albedo: road })),
    material,
    STREET_POOL_NAME,
  );
  for (const mesh of [floodPool, streetPool]) if (mesh !== null) object.add(mesh);
  return {
    object,
    lights,
    casting,
    setLook({ yardLight, yardSpots, yardShadow }) {
      for (const light of lights) light.visible = yardSpots;
      shadowWanted = yardShadow;
      applyCasting();
      if (floodPool !== null) floodPool.visible = yardLight && !yardSpots;
      if (streetPool !== null) streetPool.visible = yardLight;
    },
    update() {
      const on = shadowWanted && !gradeDisabled();
      if (casting.some((light) => light.castShadow !== on)) applyCasting();
    },
    queueShadows() {
      for (const light of casting) queueShadow(light);
    },
    dispose() {
      for (const light of lights) light.dispose();
      floodPool?.geometry.dispose();
      streetPool?.geometry.dispose();
      material.dispose();
    },
  };
}

/** A graded Lambert shadow receiver under four mast spots, two casting: the program the lit views build at High at night. */
export function floodLitSample(): GradeSample {
  const geometry = new BoxGeometry();
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const material = new MeshLambertNodeMaterial({ vertexColors: true });
  setGraded(material, true);
  const lights = Array.from({ length: 4 }, (_, i) => {
    const light = new SpotLight(
      FLOOD.colour,
      1,
      FLOOD.distance,
      FLOOD.angle,
      FLOOD.penumbra,
      FLOOD.decay,
    );
    light.castShadow = i < FLOOD_SHADOW.casting;
    return light;
  });
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  return {
    mesh,
    lights,
    dispose: () => {
      for (const light of lights) light.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
