import { Color, Matrix4, type Object3D, Vector3, Vector4 } from 'three';
import {
  clamp,
  float,
  length,
  max,
  mix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

/*
 * Road grime, contact shading and surface variation on the reflective vehicles (#556). Every term
 * comes from the part's own geometry: the height above the ground and the distance to its axles, in
 * the body frame of the group the mesh hangs under, so it rides with the vehicle and never reads
 * exercise state. One generic formula (`grime`) runs on numbers for the tests and on nodes for the shader.
 */

/** Named in the generated shader, so the vehicle shader check sees the weathering was built. */
export const GRIME_MARKER = 'vehicleGrime';

/** Most axles one body frame carries; the shader takes them as one vec4. */
export const MAX_AXLES = 4;

const GRIME_TOP = 1.5; // metres above the ground where the road grime has faded out
const GRIME_FULL = 0.3;
const LOW_SHARE = 0.55;
const ARCH_REACH = 0.4; // beyond the tyre
const ARCH_INSET = 0.1; // inside the tread: the rim and the sidewall below it stay out of the arch
const ARCH_SHARE = 0.55;
const SPRAY_LENGTH = 1.4; // behind the tyre
const SPRAY_TOP = 1.3;
const SPRAY_SHARE = 0.3;
const CONTACT_REACH = 0.5;
/** Far enough from any vehicle part that an unused axle slot adds nothing. */
const NO_AXLE = 1e4;

/** Road dust: it darkens light paint and greys the black chassis, as on a working vehicle. */
const DIRT = new Color(0x6b6257);
const DIRT_COVER = 0.6; // share of dust where the grime is full
const CONTACT_DARKEN = 0.3;
const GRIME_ROUGHNESS = 0.85;
const BLOTCH_FREQUENCY = 1.6; // per metre: patches of spray
const BLOTCH_SHARE = 0.35;
const MOTTLE = 0.03; // albedo variation
/** Per metre: the broad orange peel of painted steel and the finer weave of a tarpaulin. */
const PAINT_FREQUENCY = 4;
const FABRIC_FREQUENCY = 22;
const PAINT_VARIATION = 0.06; // roughness
const FABRIC_VARIATION = 0.12;

/** The body frame of a vehicle part: its axles' x positions (metres, along the part) and wheel radius. */
export type WeatherFrame = {
  readonly axles: readonly number[];
  readonly wheelRadius: number;
  /** The tarpaulin and drop-side body: behind `front` and above `floor`, in the body frame. */
  readonly fabric?: { readonly front: number; readonly floor: number };
};

const frames = new WeakMap<Object3D, WeatherFrame>();

/** Makes `group`'s frame the body frame of every mesh below it, up to a nearer registered group. */
export function setWeatherFrame(group: Object3D, frame: WeatherFrame): void {
  if (frame.axles.length > MAX_AXLES)
    throw new Error(`a weather frame has at most ${MAX_AXLES} axles`);
  frames.set(group, frame);
}

/** The group whose body frame `object` is weathered in, and that frame; null outside a vehicle. */
export function weatherFrameOf(
  object: Object3D,
): { readonly group: Object3D; readonly frame: WeatherFrame } | null {
  for (let o: Object3D | null = object; o !== null; o = o.parent) {
    const frame = frames.get(o);
    if (frame !== undefined) return { group: o, frame };
  }
  return null;
}

/** The arithmetic the grime formula needs, over plain numbers or shader nodes. */
type Arith<T> = {
  c(value: number): T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  max(a: T, b: T): T;
  clamp01(a: T): T;
  hypot(a: T, b: T): T;
  smoothstep(from: T, to: T, x: T): T;
};

const numbers: Arith<number> = {
  c: (value) => value,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  max: Math.max,
  clamp01: (a) => Math.min(1, Math.max(0, a)),
  hypot: Math.hypot,
  smoothstep: (from, to, x) => {
    const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
    return t * t * (3 - 2 * t);
  },
};

type FloatNode = Node<'float'>;
const nodes: Arith<FloatNode> = {
  c: (value) => float(value),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  max: (a, b) => max(a, b),
  clamp01: (a) => clamp(a, 0, 1),
  hypot: (a, b) => length(vec2(a, b)),
  smoothstep: (from, to, x) => smoothstep(from, to, x),
};

type Terms<T> = { readonly grime: T; readonly contact: T };

/**
 * Grime and contact shading in 0..1 at body-frame `x` and height `h`: a band over the lowest metre,
 * strongest on the arches in a ring around each tyre and in the spray behind it; contact darkens near
 * the ground and the tyres.
 */
function terms<T>(o: Arith<T>, x: T, h: T, axles: readonly T[], radius: T): Terms<T> {
  const one = o.c(1);
  const fade = (from: T, to: T, v: T): T => o.sub(one, o.smoothstep(from, to, v));
  let arch = o.c(0);
  let spray = o.c(0);
  for (const axle of axles) {
    const dx = o.sub(x, axle);
    const toHub = o.hypot(dx, o.sub(h, radius));
    const ring = o.mul(
      o.smoothstep(o.sub(radius, o.c(ARCH_INSET)), radius, toHub),
      fade(radius, o.add(radius, o.c(ARCH_REACH)), toHub),
    );
    arch = o.max(arch, ring);
    const behind = o.mul(
      o.smoothstep(o.sub(o.c(-SPRAY_LENGTH), radius), o.mul(radius, o.c(-1)), dx),
      fade(o.mul(radius, o.c(-0.5)), o.c(0), dx),
    );
    spray = o.max(spray, behind);
  }
  const low = fade(o.c(GRIME_FULL), o.c(GRIME_TOP), h);
  const grime = o.clamp01(
    o.add(
      o.add(o.mul(low, o.c(LOW_SHARE)), o.mul(arch, o.c(ARCH_SHARE))),
      o.mul(o.mul(spray, fade(o.c(0.3), o.c(SPRAY_TOP), h)), o.c(SPRAY_SHARE)),
    ),
  );
  const contact = o.max(fade(o.c(0), o.c(CONTACT_REACH), h), o.mul(arch, o.c(0.5)));
  return { grime, contact };
}

/** `terms` on numbers: what the shader computes, up to float precision. */
export const grimeAt = (x: number, h: number, axles: readonly number[], radius: number) =>
  terms(numbers, x, h, axles, radius);

/** Albedo and roughness of the weathered surface, faded in by `strength`. */
export type Weathering = {
  albedo(base: Node<'vec3'>): Node<'vec3'>;
  roughness(base: Node<'float'>): Node<'float'>;
};

/** The weathering nodes of one material; `strength` 0 leaves the plain look exactly. */
export function weatheringNodes(strength: Node<'float'>): Weathering {
  const toFrame = uniform(new Matrix4()).onObjectUpdate(({ object }, self) => {
    const found = object === null ? null : weatherFrameOf(object);
    if (found === null) return self.value.identity();
    return self.value.copy(found.group.matrixWorld).invert();
  });
  const axles = uniform(new Vector4(NO_AXLE, NO_AXLE, NO_AXLE, NO_AXLE)).onObjectUpdate(
    ({ object }, self) => {
      const list = (object === null ? null : weatherFrameOf(object))?.frame.axles ?? [];
      const [a = NO_AXLE, b = NO_AXLE, c = NO_AXLE, d = NO_AXLE] = list;
      return self.value.set(a, b, c, d);
    },
  );
  // wheel radius, then the fabric region's front and floor
  const shape = uniform(new Vector3(0, -NO_AXLE, NO_AXLE)).onObjectUpdate(({ object }, self) => {
    const frame = (object === null ? null : weatherFrameOf(object))?.frame;
    const fabric = frame?.fabric;
    return self.value.set(
      frame?.wheelRadius ?? 0,
      fabric?.front ?? -NO_AXLE,
      fabric?.floor ?? NO_AXLE,
    );
  });
  const p = toFrame.mul(vec4(positionWorld, 1)).xyz.toVar();
  const { grime: raw, contact } = terms(
    nodes,
    p.x,
    p.y,
    [axles.x, axles.y, axles.z, axles.w],
    shape.x,
  );
  const blotch = mx_noise_float(p.mul(BLOTCH_FREQUENCY));
  const grime = raw
    .mul(float(1 - BLOTCH_SHARE).add(blotch.mul(BLOTCH_SHARE)))
    .mul(strength)
    .toVar(GRIME_MARKER);
  const fabric = float(1)
    .sub(smoothstep(shape.y.sub(0.01), shape.y, p.x))
    .mul(smoothstep(shape.z, shape.z.add(0.01), p.y));
  const fine = mx_noise_float(p.mul(mix(float(PAINT_FREQUENCY), FABRIC_FREQUENCY, fabric)));
  const variation = mix(float(PAINT_VARIATION), FABRIC_VARIATION, fabric).mul(strength);
  const dirt = vec3(DIRT.r, DIRT.g, DIRT.b);
  const shade = float(1)
    .sub(contact.mul(CONTACT_DARKEN).mul(strength))
    .mul(float(1).add(blotch.mul(MOTTLE).mul(strength)));
  return {
    albedo: (base) => mix(base, dirt, grime.mul(DIRT_COVER)).mul(shade),
    roughness: (base) =>
      mix(clamp(base.add(fine.mul(variation)), 0, 1), float(GRIME_ROUGHNESS), grime),
  };
}
