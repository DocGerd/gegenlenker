import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { isGlassTile, tileUv, type Tile } from './skyline-atlas';
import { BOOM_REACH, rng, type Building } from './skyline-layout';

/*
 * Solid low-poly buildings in Three space (x, y up, z = -sim y): extruded profiles for the roofed
 * ones, lofted rings for the landmarks. Every face is built from the outside, so a missing or
 * inverted face shows up as a failing closed-solid check rather than a hole in the cockpit.
 */

/** Footings reach below ground, so the base never floats however the ground ends. */
export const SINK = 1;
const FLOOR = 3.6;
const BAY = 3;
const FASCIA = 0.9;
const PANEL = 4;
const ROOF_CELL = 6;
/** Share of window quads that are lit at night. */
export const LIT_SHARE = 0.25;
/** Brightness of a lit window, drawn between these. */
const LIT_LEVEL = [0.6, 1] as const;
/** Splits the window stream from the facade stream, so the day facades stay as they were. */
const WINDOW_STREAM = 0x5bd1e995;
export const GLOW_ATTRIBUTE = 'glow';

type Pt = readonly [number, number];
type Tag = 'wall' | 'roof' | 'glaze' | 'base';
type Face = (m: Mesher, o: Vector3, u: Vector3, v: Vector3, out: Vector3) => void;
type Skin = {
  readonly wall: Face;
  readonly roof: Face;
  readonly glaze: Face;
  readonly base: Tile;
  readonly cap: Tile;
};
type Profile = {
  readonly points: readonly Pt[]; // counter-clockwise in (across, up)
  readonly tags: readonly Tag[]; // tag of the edge leaving each point
  readonly wallCap: { readonly s0: number; readonly s1: number; readonly y1: number } | null;
  readonly restCaps: readonly (readonly Pt[])[];
};

class Mesher {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly haze: number[] = [];
  readonly glow: number[] = [];
  private level = 0;
  private windows: () => number = () => 1;
  private cos = 1;
  private sin = 0;
  private ox = 0;
  private oz = 0;
  private share = 0;

  /** Local frame of the building about to be added: heading is Three's `rotation.y`. */
  place(heading: number, ox: number, oz: number, share: number, seed: number): void {
    this.windows = rng(seed ^ WINDOW_STREAM);
    this.cos = Math.cos(heading);
    this.sin = Math.sin(heading);
    this.ox = ox;
    this.oz = oz;
    this.share = share;
  }

  private push(p: Vector3, n: Vector3, uv: Pt): void {
    this.position.push(
      p.x * this.cos + p.z * this.sin + this.ox,
      p.y,
      -p.x * this.sin + p.z * this.cos + this.oz,
    );
    this.normal.push(n.x * this.cos + n.z * this.sin, n.y, -n.x * this.sin + n.z * this.cos);
    this.uv.push(uv[0], uv[1]);
    this.haze.push(this.share);
    this.glow.push(this.level);
  }

  /** Sets the glow of the quad about to be pushed: a seeded level on glass, 0 elsewhere. */
  glowFor(tile: Tile | null): void {
    if (tile === null || !isGlassTile(tile)) {
      this.level = 0;
      return;
    }
    const lit = this.windows() < LIT_SHARE;
    const spread = this.windows();
    this.level = lit ? LIT_LEVEL[0] + (LIT_LEVEL[1] - LIT_LEVEL[0]) * spread : 0;
  }

  /** One triangle, wound so its normal agrees with `out`; degenerate ones are dropped. */
  tri(a: Vector3, b: Vector3, c: Vector3, out: Vector3, ua: Pt, ub: Pt, uc: Pt): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    if (n.dot(out) >= 0) {
      this.push(a, n, ua);
      this.push(b, n, ub);
      this.push(c, n, uc);
    } else {
      n.negate();
      this.push(a, n, ua);
      this.push(c, n, uc);
      this.push(b, n, ub);
    }
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('haze', new Float32BufferAttribute(this.haze, 1));
    g.setAttribute(GLOW_ATTRIBUTE, new Float32BufferAttribute(this.glow, 1));
    return g;
  }
}

/** A quad `o + a*u + b*v` for a in [a0, a1], b in [b0, b1], showing the whole of `tile`. */
function quad(
  m: Mesher,
  o: Vector3,
  u: Vector3,
  v: Vector3,
  [a0, a1, b0, b1]: readonly [number, number, number, number],
  out: Vector3,
  tile: Tile,
): void {
  const at = (a: number, b: number): Vector3 =>
    o.clone().addScaledVector(u, a).addScaledVector(v, b);
  const { u0, u1, v0, v1 } = tileUv(tile);
  const p00 = at(a0, b0);
  const p10 = at(a1, b0);
  const p11 = at(a1, b1);
  const p01 = at(a0, b1);
  m.glowFor(tile);
  m.tri(p00, p10, p11, out, [u0, v0], [u1, v0], [u1, v1]);
  m.tri(p00, p11, p01, out, [u0, v0], [u1, v1], [u0, v1]);
  m.glowFor(null);
}

/** A face cut into columns of about `colWidth` and the given row heights, bottom up. */
function cells(
  m: Mesher,
  [o, u, v, out]: readonly [Vector3, Vector3, Vector3, Vector3],
  colWidth: number,
  rows: readonly number[],
  pick: (col: number, row: number) => Tile,
): void {
  const cols = Math.max(1, Math.round(u.length() / colWidth));
  const total = rows.reduce((a, b) => a + b, 0);
  let b0 = 0;
  rows.forEach((h, r) => {
    const b1 = b0 + h / total;
    for (let c = 0; c < cols; c++)
      quad(m, o, u, v, [c / cols, (c + 1) / cols, b0, b1], out, pick(c, r));
    b0 = b1;
  });
}

const flat =
  (tile: Tile): Face =>
  (m, o, u, v, out) => {
    quad(m, o, u, v, [0, 1, 0, 1], out, tile);
  };

function plainSkin(tile: Tile): Skin {
  return { wall: flat(tile), roof: flat(tile), glaze: flat(tile), base: tile, cap: tile };
}

const roofCells =
  (next: () => number, tiles: readonly Tile[]): Face =>
  (m, o, u, v, out) => {
    const rows = Math.max(1, Math.round(v.length() / ROOF_CELL));
    cells(m, [o, u, v, out], ROOF_CELL, Array<number>(rows).fill(1), () => {
      return tiles[Math.floor(next() * tiles.length)] ?? 'roofFlat';
    });
  };

const glazingCells: Face = (m, o, u, v, out) => {
  cells(m, [o, u, v, out], PANEL, [1], () => 'glazing');
};

function officeSkin(variant: number, next: () => number): Skin {
  const s = variant % 2 === 0 ? 'L' : 'D';
  const glass = (): Tile => {
    const p = next();
    if (p < 0.4) return `glassDark${s}`;
    if (p < 0.65) return `glassMid${s}`;
    if (p < 0.85) return `glassSky${s}`;
    return `glassBlind${s}`;
  };
  return {
    wall: (m, o, u, v, out) => {
      const floors = Math.max(1, Math.round((v.length() - SINK - FASCIA) / FLOOR));
      const rows = [...Array<number>(floors).fill((v.length() - FASCIA) / floors), FASCIA];
      cells(m, [o, u, v, out], BAY, rows, (_, r) => (r === floors ? `fascia${s}` : glass()));
    },
    roof: roofCells(next, ['roofFlat', 'roofFlat', 'roofSkylights']),
    glaze: glazingCells,
    base: 'plainDark',
    cap: s === 'L' ? 'plainLight' : 'plainDark',
  };
}

const CLADDING = [
  { rib: 'ribLight', band: 'bandedLight', plain: 'plainLight', seam: 'roofSeamLight', fascia: 'D' },
  { rib: 'ribMid', band: 'bandedDark', plain: 'plainMid', seam: 'roofSeamDark', fascia: 'D' },
  { rib: 'ribDark', band: 'bandedDark', plain: 'plainDark', seam: 'roofSeamDark', fascia: 'L' },
] as const;

function claddedSkin(variant: number, ribbed: boolean, next: () => number): Skin {
  const c = CLADDING[variant % CLADDING.length] ?? CLADDING[0];
  return {
    wall: (m, o, u, v, out) => {
      const rows = [v.length() - FASCIA, FASCIA];
      cells(m, [o, u, v, out], PANEL, rows, (_, r) =>
        r === 1 ? `fascia${c.fascia}` : ribbed ? c.rib : c.band,
      );
    },
    roof:
      ribbed || next() < 0.5
        ? (m, o, u, v, out) => {
            cells(m, [o, u, v, out], PANEL, [1], () => c.seam);
          }
        : roofCells(next, ['roofFlat', 'roofSkylights']),
    glaze: glazingCells,
    base: c.plain,
    cap: c.plain,
  };
}

type Axis = 'x' | 'z';

/** Extrudes `profile` (across, up) along `axis` from t0 to t1, skinning every face. */
function prism(m: Mesher, profile: Profile, axis: Axis, t0: number, t1: number, skin: Skin): void {
  const at = (t: number, s: number, y: number): Vector3 =>
    axis === 'x' ? new Vector3(t, y, s) : new Vector3(s, y, t);
  const along = at(1, 0, 0);
  const across = at(0, 1, 0);
  const up = at(0, 0, 1);
  const n = profile.points.length;
  profile.points.forEach((a, i) => {
    const b = profile.points[(i + 1) % n] ?? a;
    const ds = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(ds, dy);
    const out = at(0, dy / length, -ds / length);
    const [lo, hi] = a[1] <= b[1] ? [a, b] : [b, a];
    const lift = at(0, hi[0] - lo[0], hi[1] - lo[1]);
    const u = lift
      .clone()
      .cross(out)
      .normalize()
      .multiplyScalar(Math.abs(t1 - t0));
    const o = at(u.dot(along) > 0 ? t0 : t1, lo[0], lo[1]);
    const tag = profile.tags[i] ?? 'wall';
    if (tag === 'base') flat(skin.base)(m, o, u, lift, out);
    else skin[tag](m, o, u, lift, out);
  });
  for (const [t, sign] of [
    [t0, -1],
    [t1, 1],
  ] as const) {
    const out = along.clone().multiplyScalar(sign);
    const { wallCap } = profile;
    if (wallCap !== null) {
      const u = up
        .clone()
        .cross(out)
        .normalize()
        .multiplyScalar(wallCap.s1 - wallCap.s0);
      const o = at(t, u.dot(across) > 0 ? wallCap.s0 : wallCap.s1, -SINK);
      skin.wall(m, o, u, up.clone().multiplyScalar(wallCap.y1 + SINK), out);
    }
    const { u0, u1, v0, v1 } = tileUv(skin.cap);
    const uv: Pt = [(u0 + u1) / 2, (v0 + v1) / 2];
    for (const poly of profile.restCaps) {
      const [first, ...rest] = poly.map((p) => at(t, p[0], p[1]));
      for (let k = 0; first !== undefined && k + 1 < rest.length; k++) {
        const p = rest[k];
        const q = rest[k + 1];
        if (p !== undefined && q !== undefined) m.tri(first, p, q, out, uv, uv, uv);
      }
    }
  }
}

function rectProfile(s0: number, s1: number, y0: number, y1: number): Profile {
  return {
    points: [
      [s0, y0],
      [s1, y0],
      [s1, y1],
      [s0, y1],
    ],
    tags: ['base', 'wall', 'roof', 'wall'],
    wallCap: null,
    restCaps: [
      [
        [s0, y0],
        [s1, y0],
        [s1, y1],
        [s0, y1],
      ],
    ],
  };
}

/** A solid box in the local frame, plainly tiled. */
function block(
  m: Mesher,
  [x0, x1]: readonly [number, number],
  [z0, z1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  tile: Tile,
): void {
  prism(m, rectProfile(z0, z1, y0, y1), 'x', x0, x1, plainSkin(tile));
}

function roofProfile(b: Building): Profile {
  const half = b.depth / 2;
  const eave = b.height;
  const base: Pt[] = [
    [-half, -SINK],
    [half, -SINK],
    [half, eave],
  ];
  const cap = { s0: -half, s1: half, y1: eave };
  switch (b.roof) {
    case 'flat':
      return {
        points: [...base, [-half, eave]],
        tags: ['base', 'wall', 'roof', 'wall'],
        wallCap: cap,
        restCaps: [],
      };
    case 'gable': {
      const ridge = eave + b.depth * 0.12;
      return {
        points: [...base, [0, ridge], [-half, eave]],
        tags: ['base', 'wall', 'roof', 'roof', 'wall'],
        wallCap: cap,
        restCaps: [
          [
            [-half, eave],
            [half, eave],
            [0, ridge],
          ],
        ],
      };
    }
    case 'shed': {
      const high = eave + b.depth * 0.08;
      return {
        points: [...base, [-half, high]],
        tags: ['base', 'wall', 'roof', 'wall'],
        wallCap: cap,
        restCaps: [
          [
            [-half, eave],
            [half, eave],
            [-half, high],
          ],
        ],
      };
    }
    case 'sawtooth': {
      const teeth = Math.max(2, Math.round(b.depth / 9));
      const pitch = b.depth / teeth;
      const rise = 2.8;
      const points: Pt[] = [...base];
      const tags: Tag[] = ['base', 'wall'];
      const restCaps: Pt[][] = [];
      for (let i = 0; i < teeth; i++) {
        const left = half - (i + 1) * pitch;
        points.push([left, eave + rise]);
        tags.push('roof');
        restCaps.push([
          [left + pitch, eave],
          [left, eave + rise],
          [left, eave],
        ]);
        if (i < teeth - 1) {
          points.push([left, eave]);
          tags.push('glaze');
        }
      }
      tags.push('wall');
      return { points, tags, wallCap: cap, restCaps };
    }
  }
}

/** Rings of a regular polygon, narrowing or swelling with height: chimney, poplar, pylon mast. */
function loft(
  m: Mesher,
  sides: number,
  rings: readonly (readonly [number, number])[],
  tiles: readonly Tile[],
): void {
  const corner = (y: number, half: number, k: number): Vector3 => {
    const angle = ((k + 0.5) / sides) * Math.PI * 2;
    return new Vector3(Math.cos(angle) * half, y, Math.sin(angle) * half);
  };
  rings.forEach((lower, r) => {
    const upper = rings[r + 1];
    if (upper === undefined) return;
    const { u0, u1, v0, v1 } = tileUv(tiles[r % tiles.length] ?? 'plainMid');
    for (let k = 0; k < sides; k++) {
      const a = corner(lower[0], lower[1], k);
      const b = corner(lower[0], lower[1], k + 1);
      const c = corner(upper[0], upper[1], k + 1);
      const d = corner(upper[0], upper[1], k);
      const mid = new Vector3().add(a).add(b).add(c).add(d);
      const out = new Vector3(mid.x, 0, mid.z);
      m.tri(a, b, c, out, [u0, v0], [u1, v0], [u1, v1]);
      m.tri(a, c, d, out, [u0, v0], [u1, v1], [u0, v1]);
    }
  });
  const first = rings[0];
  const last = rings[rings.length - 1];
  for (const [ring, out] of [
    [first, new Vector3(0, -1, 0)],
    [last, new Vector3(0, 1, 0)],
  ] as const) {
    if (ring === undefined) continue;
    const { u0, v0 } = tileUv(tiles[0] ?? 'plainMid');
    for (let k = 1; k + 1 < sides; k++) {
      m.tri(
        corner(ring[0], ring[1], 0),
        corner(ring[0], ring[1], k),
        corner(ring[0], ring[1], k + 1),
        out,
        [u0, v0],
        [u0, v0],
        [u0, v0],
      );
    }
  }
}

/** One closed solid: pieces of a landmark may overlap each other, so each is checked alone. */
type Piece = (m: Mesher) => void;

function cranePieces(b: Building): Piece[] {
  const span = b.length / 2;
  const gauge = b.depth / 2;
  const deck = b.height * 0.78;
  const top = deck + 2.6;
  const leg = 1.2;
  const reach = span + b.length * BOOM_REACH - b.length / 2;
  const lift = b.height * 0.3;
  const pieces: Piece[] = [];
  for (const x of [-span, span]) {
    for (const z of [-gauge, gauge]) {
      pieces.push((m) => {
        block(m, [x - leg, x + leg], [z - leg, z + leg], [-SINK, deck], 'steel');
      });
    }
  }
  for (const z of [-gauge, gauge]) {
    pieces.push((m) => {
      block(m, [-span - 1.4, span + 1.4], [z - 1.3, z + 1.3], [deck, top], 'steel');
    });
  }
  pieces.push(
    (m) => {
      block(m, [-span * 0.7, -span * 0.1], [-gauge - 1.3, gauge + 1.3], [deck, top], 'steel');
    },
    (m) => {
      block(m, [-span * 0.6, -span * 0.2], [-3, 3], [top, top + 6], 'stripeRed');
    },
  );
  const boom: Profile = {
    points: [
      [span, deck + 0.2],
      [reach, deck + lift],
      [reach, deck + lift + 2.2],
      [span, top],
    ],
    tags: ['wall', 'wall', 'wall', 'wall'],
    wallCap: null,
    restCaps: [
      [
        [span, deck + 0.2],
        [reach, deck + lift],
        [reach, deck + lift + 2.2],
        [span, top],
      ],
    ],
  };
  for (const z of [-gauge, gauge]) {
    pieces.push((m) => {
      prism(m, boom, 'z', z - 1, z + 1, plainSkin('steel'));
    });
  }
  return pieces;
}

function landmarkPieces(b: Building): Piece[] | null {
  const base = b.length / 2;
  switch (b.kind) {
    case 'chimney': {
      const rings = Array.from({ length: 7 }, (_, i): [number, number] => [
        -SINK + ((b.height + SINK) * i) / 6,
        base * (1 - 0.4 * (i / 6)),
      ]);
      return [
        (m) => {
          loft(m, 8, rings, [
            'stripeWhite',
            'stripeWhite',
            'stripeRed',
            'stripeWhite',
            'stripeRed',
            'stripeWhite',
          ]);
        },
      ];
    }
    case 'poplar':
      return [
        (m) => {
          loft(
            m,
            6,
            [
              [-SINK, base * 0.2],
              [b.height * 0.3, base],
              [b.height * 0.75, base * 0.8],
              [b.height, 0],
            ],
            ['foliage'],
          );
        },
      ];
    case 'pylon': {
      const bar = 1.2;
      return [
        (m) => {
          loft(
            m,
            4,
            [
              [-SINK, base],
              [b.height * 0.62, base * 0.25],
              [b.height, base * 0.12],
            ],
            ['steel'],
          );
        },
        (m) => {
          block(
            m,
            [-base * 1.2, base * 1.2],
            [-bar / 2, bar / 2],
            [b.height * 0.62, b.height * 0.62 + bar],
            'steel',
          );
        },
        (m) => {
          block(
            m,
            [-base * 0.85, base * 0.85],
            [-bar / 2, bar / 2],
            [b.height * 0.82, b.height * 0.82 + bar],
            'steel',
          );
        },
      ];
    }
    case 'crane':
      return cranePieces(b);
    default:
      return null;
  }
}

function piecesOf(b: Building): readonly Piece[] {
  const landmark = landmarkPieces(b);
  if (landmark !== null) return landmark;
  return [
    (m) => {
      const next = rng(b.seed);
      const skin =
        b.kind === 'office'
          ? officeSkin(b.skin, next)
          : claddedSkin(b.skin, b.kind === 'hall', next);
      prism(m, roofProfile(b), 'x', -b.length / 2, b.length / 2, skin);
    },
  ];
}

function addBuilding(m: Mesher, b: Building): void {
  m.place(b.heading, b.x, -b.y, b.haze, b.seed);
  for (const piece of piecesOf(b)) piece(m);
}

/** One building, world space: for tests and callers that want a single solid. */
export function buildingGeometry(b: Building): BufferGeometry {
  const m = new Mesher();
  addBuilding(m, b);
  return m.geometry();
}

/** The closed solids a building is made of, world space: for tests. */
export function buildingParts(b: Building): BufferGeometry[] {
  return piecesOf(b).map((piece) => {
    const m = new Mesher();
    m.place(b.heading, b.x, -b.y, b.haze, b.seed);
    piece(m);
    return m.geometry();
  });
}

/** Every building in one geometry, so the skyline is a single draw call. */
export function skylineGeometry(buildings: readonly Building[]): BufferGeometry {
  const m = new Mesher();
  for (const b of buildings) addBuilding(m, b);
  return m.geometry();
}
