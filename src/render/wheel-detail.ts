import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  Float32BufferAttribute,
  LatheGeometry,
  RingGeometry,
  Vector2,
} from 'three';
import { REALISM_HUES as HUE } from './realism-hues';
import { tint } from './tint';

/*
 * The `wheelDetail` wheel: a lathe tyre with rounded shoulders, sidewall bulge and tread grooves, a
 * dished rim with studs and a hub cap, and a brake drum on the inboard side. Every proportion is a
 * render estimate, not a vehicle Param; lengths are fractions of the tyre radius unless in metres.
 */
export const WHEEL_LOOK = {
  segments: 24,
  bead: 0.6, // rim flange radius, where the tyre meets the rim
  shoulder: 0.045, // m
  bulge: 0.01, // m past the tread's half width: the discs' sidewall relief
  grooves: [-0.4, 0.4], // centres, of the tread's half width
  grooveWidth: 0.014, // m
  grooveDepth: 0.012, // m
  dish: 0.12, // rim disc inset from the bead plane
  dishRim: 0.46, // where the dish reaches the disc face
  cap: 0.2, // hub cap radius
  capHeight: 0.16, // from the disc face
  studRing: 0.33,
  studs: 8,
  studSize: 0.07,
  studHeight: 0.06,
  nutRing: [0.27, 0.39], // truck rims: silver band behind the studs
  drum: 0.42,
  drumDepth: 0.2, // inboard of the bead plane
  treadMix: 0.5, // tread hue: this share of anthracite over the sidewall's black
} as const;

/** Body y (outward +y) to Three space, with the axle along body y; the profile's `h` is body y. */
const AXLE = -Math.PI / 2;
const NUT_RING_RELIEF = 0.006; // m off the disc face

type ProfilePoint = { readonly r: number; readonly h: number; readonly color: Color };

const linear = (hue: number): Color => new Color().set(hue);
const mix = (a: number, b: number, t: number): Color => linear(a).lerp(linear(b), t);

/** A surface of revolution about the axle, coloured per profile point. Ordered so the normals face out. */
function lathe(points: readonly ProfilePoint[]): BufferGeometry {
  const geometry = new LatheGeometry(
    points.map((p) => new Vector2(p.r, p.h)),
    WHEEL_LOOK.segments,
  );
  geometry.deleteAttribute('uv');
  const n = geometry.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = points[i % points.length]?.color;
    if (c !== undefined) c.toArray(colors, i * 3);
  }
  return geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

/** Tyre profile from the inboard bead over the tread to the outboard bead. */
export function tyreProfile(radius: number, width: number): ProfilePoint[] {
  const L = WHEEL_LOOK;
  const w = width / 2;
  const bead = radius * L.bead;
  const top = radius - L.shoulder;
  const sidewall = linear(HUE.chevronBlack);
  const tread = mix(HUE.chevronBlack, HUE.anthracite, L.treadMix);
  const half: ProfilePoint[] = [
    { r: bead, h: -(w - L.bulge), color: sidewall },
    { r: bead + 0.45 * (top - bead), h: -(w + L.bulge), color: sidewall },
  ];
  for (const deg of [0, 45, 90]) {
    const a = (deg * Math.PI) / 180;
    half.push({
      r: top + L.shoulder * Math.sin(a),
      h: -(w - L.shoulder) - L.shoulder * Math.cos(a),
      color: mix(HUE.chevronBlack, HUE.anthracite, (L.treadMix * deg) / 90),
    });
  }
  const grooves: ProfilePoint[] = [];
  const reach = w - L.shoulder;
  for (const at of L.grooves) {
    const c = at * reach;
    const [g0, g1] = [c - L.grooveWidth / 2, c + L.grooveWidth / 2];
    const floor = radius - L.grooveDepth;
    grooves.push(
      { r: radius, h: g0, color: tread },
      { r: floor, h: g0, color: sidewall },
      { r: floor, h: g1, color: sidewall },
      { r: radius, h: g1, color: tread },
    );
  }
  const mirrored = half.map((p) => ({ ...p, h: -p.h })).reverse();
  return [...half, ...grooves, ...mirrored];
}

export type WheelOptions = {
  readonly radius: number;
  readonly width: number;
  /** Which way body y the outboard face looks. */
  readonly outward: 1 | -1;
  /** Black rim with a silver nut ring and studs; otherwise a silver rim. */
  readonly truck: boolean;
  /** Dished rim, studs and hub cap on the outboard face; a plain disc closes it otherwise (hidden twin faces). */
  readonly rimFace: boolean;
  /** Brake drum on the inboard face; a plain disc closes it otherwise. */
  readonly drum: boolean;
};

/**
 * One wheel at the origin with its axle along body y, in Three space, vertex-coloured and without
 * UVs. Nothing reaches below the tread's lowest point or past the bulge on the outboard side but the
 * hub cap; only the drum goes inboard of the tyre.
 */
export function detailedWheel(o: WheelOptions): BufferGeometry[] {
  const L = WHEEL_LOOK;
  const R = o.radius;
  const w = o.width / 2;
  const bead = R * L.bead;
  const plane = w - L.bulge;
  const rimHue = o.truck ? HUE.chevronBlack : HUE.whiteAluminium;
  const rim = linear(rimHue);
  const dark = linear(HUE.chevronBlack);
  const parts: BufferGeometry[] = [lathe(tyreProfile(R, o.width))];

  if (o.rimFace) {
    const face = plane - L.dish * R;
    parts.push(
      lathe([
        { r: bead, h: plane, color: rim },
        { r: R * L.dishRim, h: face, color: rim },
        { r: R * L.cap, h: face, color: dark },
        { r: R * L.cap * 0.8, h: face + R * L.capHeight, color: dark },
        { r: 0, h: face + R * L.capHeight, color: dark },
      ]),
    );
    if (o.truck) {
      const [inner, outer] = L.nutRing;
      parts.push(
        tint(
          new RingGeometry(R * inner, R * outer, L.segments)
            .rotateX(AXLE)
            .translate(0, face + NUT_RING_RELIEF, 0),
          linear(HUE.whiteAluminium),
        ),
      );
    }
    const size = R * L.studSize;
    const studHue = linear(o.truck ? HUE.whiteAluminium : HUE.anthracite);
    for (let i = 0; i < L.studs; i++) {
      const a = (i / L.studs) * 2 * Math.PI;
      parts.push(
        tint(
          new BoxGeometry(size, R * L.studHeight, size).translate(
            R * L.studRing * Math.sin(a),
            face + (R * L.studHeight) / 2,
            R * L.studRing * Math.cos(a),
          ),
          studHue,
        ),
      );
    }
  } else {
    parts.push(
      lathe([
        { r: bead, h: plane, color: rim },
        { r: 0, h: plane, color: rim },
      ]),
    );
  }

  if (o.drum) {
    const back = -(w + L.drumDepth * R);
    const drum = linear(HUE.anthracite);
    parts.push(
      lathe([
        { r: 0, h: back, color: drum },
        { r: R * L.drum, h: back, color: drum },
        { r: R * L.drum, h: -plane, color: drum },
        { r: bead, h: -plane, color: rim },
      ]),
    );
  } else {
    parts.push(
      lathe([
        { r: 0, h: -plane, color: rim },
        { r: bead, h: -plane, color: rim },
      ]),
    );
  }

  for (const part of parts) {
    part.rotateX(AXLE);
    if (o.outward < 0) part.rotateX(Math.PI);
  }
  return parts;
}

/** How far inboard of the wheel centre the drum's back reaches. */
export const drumReach = (radius: number, width: number): number =>
  width / 2 + WHEEL_LOOK.drumDepth * radius;
