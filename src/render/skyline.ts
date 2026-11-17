import { SKY_LAYER } from './seams';
import { DOME_PROJECTION } from './sky';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
} from 'three';

// Silhouettes live in dome space (azimuth, elevation) and render like the sky dome: camera
// rotation only, depth at the far plane. The ring serves the cockpit and both mirrors and is on
// SKY_LAYER, which the top-down camera skips.
const VERTEX = /* glsl */ `
attribute vec3 tone;
varying vec3 vTone;
void main() {
  vTone = tone;
  ${DOME_PROJECTION}
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vTone;
void main() {
  gl_FragColor = vec4(vTone, 1.0);
  #include <colorspace_fragment>
}
`;

const BASE_ELEVATION = -0.03; // below the horizon, so silhouettes meet the ground instead of floating
const FAR_HAZE = 0.5; // share of haze mixed into the far ring
const BASE_HAZE = 0.45; // share of haze at the foot of a silhouette
const FAR_DISTANCE = 340;
const NEAR_DISTANCE = 190;
const TAU = Math.PI * 2;

type Kind = 'hall' | 'chimney' | 'crane' | 'poplar' | 'pylon';

/** Pattern repeated around the ring: mostly halls and poplars, with the odd landmark. */
const KINDS: readonly Kind[] = [
  'hall',
  'hall',
  'poplar',
  'hall',
  'crane',
  'poplar',
  'hall',
  'pylon',
  'hall',
  'chimney',
  'poplar',
  'hall',
  'crane',
  'hall',
];

/** A convex polygon in (azimuth, elevation) offsets from the silhouette's anchor, in radians. */
export type Part = readonly (readonly [number, number])[];

export type Silhouette = {
  readonly azimuth: number;
  readonly far: boolean;
  readonly parts: readonly Part[];
};

/** Deterministic xorshift in [0, 1): the same skyline in every session. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Part => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Silhouette of `kind` seen from `distance` metres; angular size is size over distance. */
function parts(kind: Kind, distance: number, next: () => number): readonly Part[] {
  const ang = (m: number): number => Math.atan2(m, distance);
  const pick = (lo: number, hi: number): number => lo + (hi - lo) * next();
  switch (kind) {
    case 'hall': {
      const w = ang(pick(40, 100)) / 2;
      const h = ang(pick(9, 18));
      const ridge = ang(pick(1.5, 3));
      return [
        [
          [-w, 0],
          [w, 0],
          [w, h],
          [0, h + ridge],
          [-w, h],
        ],
        rect(w, 0, w + ang(pick(15, 35)), ang(pick(5, 8))),
      ];
    }
    case 'chimney': {
      const base = ang(pick(4, 6)) / 2;
      const h = ang(pick(55, 85));
      const shed = ang(pick(14, 20)) / 2;
      return [
        [
          [-base, 0],
          [base, 0],
          [base * 0.6, h],
          [-base * 0.6, h],
        ],
        rect(-shed, 0, shed, ang(7)),
      ];
    }
    case 'crane': {
      // portal crane: two legs, a girder and a raised boom to one side
      const span = ang(pick(22, 30)) / 2;
      const leg = ang(1.6) / 2;
      const deck = ang(pick(28, 38));
      const girder = ang(2.5);
      const reach = ang(pick(30, 45));
      const lift = ang(pick(14, 22));
      return [
        rect(-span - leg, 0, -span + leg, deck),
        rect(span - leg, 0, span + leg, deck),
        rect(-span - leg, deck, span + leg + reach, deck + girder),
        [
          [span, deck + girder],
          [span + reach, deck + girder],
          [span + reach * 0.4, deck + girder + lift],
          [span, deck + girder + lift * 0.3],
        ],
        rect(-span * 0.6, deck + girder, -span * 0.2, deck + girder + ang(8)),
      ];
    }
    case 'poplar': {
      const w = ang(pick(5, 8)) / 2;
      const h = ang(pick(18, 28));
      return [
        [
          [-w * 0.2, 0],
          [w * 0.2, 0],
          [w, h * 0.3],
          [w * 0.8, h * 0.75],
          [0, h],
          [-w * 0.8, h * 0.75],
          [-w, h * 0.3],
        ],
      ];
    }
    case 'pylon': {
      const base = ang(pick(7, 10)) / 2;
      const h = ang(pick(40, 55));
      const arm = ang(pick(9, 12));
      const bar = ang(1.2);
      return [
        [
          [-base, 0],
          [base, 0],
          [base * 0.15, h],
          [-base * 0.15, h],
        ],
        rect(-arm, h * 0.62, arm, h * 0.62 + bar),
        rect(-arm * 0.7, h * 0.82, arm * 0.7, h * 0.82 + bar),
      ];
    }
  }
}

/** Two staggered rings of silhouettes spread around the full circle: far, then near. */
export function skylineSilhouettes(seed = 1): readonly Silhouette[] {
  const next = rng(seed);
  const out: Silhouette[] = [];
  for (const far of [true, false]) {
    const distance = far ? FAR_DISTANCE : NEAR_DISTANCE;
    let azimuth = next() * 0.3;
    let i = Math.floor(next() * KINDS.length);
    while (azimuth < TAU) {
      const kind = KINDS[i % KINDS.length] ?? 'hall';
      i += 1;
      out.push({ azimuth, far, parts: parts(kind, distance, next) });
      azimuth += (far ? 0.2 : 0.3) + next() * (far ? 0.18 : 0.35);
    }
  }
  return out;
}

function direction(azimuth: number, elevation: number, out: number[]): void {
  const c = Math.cos(elevation);
  out.push(c * Math.sin(azimuth), Math.sin(elevation), c * Math.cos(azimuth));
}

function buildGeometry(
  silhouettes: readonly Silhouette[],
  dark: Color,
  haze: Color,
): BufferGeometry {
  const position: number[] = [];
  const tone: number[] = [];
  const near = dark.clone();
  const far = dark.clone().lerp(haze, FAR_HAZE);
  const foot = new Color();
  for (const s of silhouettes) {
    const top = s.far ? far : near;
    foot.copy(top).lerp(haze, BASE_HAZE);
    for (const part of s.parts) {
      const [first, ...rest] = part;
      if (first === undefined) continue;
      for (let k = 0; k + 1 < rest.length; k++) {
        for (const p of [first, rest[k], rest[k + 1]]) {
          if (p === undefined) continue;
          direction(s.azimuth + p[0], p[1] > 0 ? p[1] : BASE_ELEVATION, position);
          const c = p[1] > 0 ? top : foot;
          tone.push(c.r, c.g, c.b);
        }
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('tone', new Float32BufferAttribute(tone, 3));
  return geometry;
}

export type Skyline = { readonly mesh: Mesh; dispose(): void };

/** `dark` is the near silhouette colour, `haze` the colour the distance fades towards. */
export function createSkyline(dark: Color, haze: Color): Skyline {
  const geometry = buildGeometry(skylineSilhouettes(), dark, haze);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2; // after the dome, which does not write depth
  mesh.layers.set(SKY_LAYER);
  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
