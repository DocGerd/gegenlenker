import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { CAB_HEIGHT, cabShellParams, FRAME_TOP, hex, round } from './cab-dims';
import { REALISM_HUES, type RealismHueKey } from './realism-hues';

// No `three` import: scripts/glb-params.mjs loads this module under plain Node.

/*
 * The cab interior of `tools/blender/interior_shell.py`, derived here and only exported there. The
 * parts are authored in the sim body frame (metres, +X forward, +Y left, +Z up), sized from the
 * driver's eye so the cockpit view keeps its sight cone and mirror lines (cockpit-interior.test.ts).
 * The cockpit camera's field of view, pitch and the cone are copies of the camera's and the
 * overlay's own, pinned by interior-dims.test.ts: those modules import `three`.
 */

export const VIEW_FOV_DEG = 55;
export const VIEW_PITCH_DEG = 6; // the camera looks this far below the horizon
export const CLEAR_CONE_HALF_DEG = 12;

export type Vec3 = readonly [number, number, number];
export type Solid = {
  readonly hue: RealismHueKey;
  readonly verts: readonly Vec3[];
  readonly faces: readonly (readonly number[])[];
};
/** `header` holds the shade band, headliner and visor, and `pillars` both A-pillars. */
export type InteriorMeshName = 'interior' | 'wheel' | 'header' | 'pillars';

const rad = (deg: number): number => (deg * Math.PI) / 180;
const TAN_V = Math.tan(rad(VIEW_FOV_DEG / 2));
const PITCH = rad(VIEW_PITCH_DEG);

/** Metres from the cab's side wall to its inner trim face; the door tops and walls are this thick. */
export const DOOR_THICKNESS = 0.12;
/** Metres the dash and header stand off the windscreen's inner face. */
export const GLASS_SETBACK = 0.06;
/** The dash's rear edge: metres ahead of the eye along the view axis, and its NDC y beside and ahead of the driver. */
export const DASH = { depth: 0.8, edge: -0.52, flank: 0.06, flankScale: 0.9 } as const;
/** The instrument binnacle straight ahead of the driver, in metres across the view at `DASH.depth`. */
export const HUMP = { halfWidth: 0.3, top: -0.475, drop: 0.12 } as const;
/** The dash and hump stay this far (degrees) under the sight cone's lower edge. */
export const CONE_MARGIN_DEG = 1.5;
const DASH_BOTTOM = 1.6;

/** The steering wheel as the cab's driver sees it, in the camera's frame: ahead, with the rim's top at `topNdc`. */
export const WHEEL = {
  depth: 0.5,
  topNdc: -0.545,
  radius: 0.21,
  tubeRadius: 0.017,
  tilt: rad(40),
  segments: 20,
} as const;

/** The shade band's lower front edge at `bottomNdc`, but never above the glass top; the visor hangs ahead of the driver. */
export const HEADER = { bottomNdc: 0.86, thickness: 0.1 } as const;
export const VISOR = {
  bottomNdc: 0.72,
  depth: 0.7,
  thickness: 0.06,
  /** Metres right and left of the eye. */
  right: 0.05,
  left: 0.4,
} as const;
/** The door tops rise from the sill at the windscreen to this much above it at the driver's end. */
export const DOOR_RISE = 0.4;
const DOOR_TOP_OVER_SILL = 0.07;

/** Metres the A-pillars reach back from the glass, and the highest the roof lining sits under the cab roof. */
export const PILLAR_DEPTH = 0.09;
const ROOF_LINING = 0.1;

/** Metres the forward door's rear end is behind the eye. */
const DOOR_BACK = 0.2;
/**
 * The cab behind the forward view, for looking around (#258): the B-pillar stands `behindEye` metres
 * behind the eye, so the side window reaches back to it from the A-pillar. The parts added lie behind
 * the eye plane, under the dash and door tops, or (rail, roof lining) a lap past the plane where no
 * ray of the forward view reaches them (pinned by interior-look-around.test.ts).
 */
export const B_PILLAR = { behindEye: 0.55, depth: 0.12, inset: 0.05 } as const;
/** Metres the rail and roof lining reach ahead of the eye plane, so a ray along it meets them. */
const EYE_PLANE_LAP = 0.02;
/** Metres the added parts stand inside the cab's skin. */
const SKIN_GAP = 0.01;
/** Metres thick the rear wall and the floor are. */
const REAR_WALL = 0.1;
const FLOOR = 0.04;
const CEILING = CAB_HEIGHT - ROOF_LINING;
/** The top of the roof lining, where the side rail and the rear wall end. */
const ROOF_TOP = CEILING + 0.02;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mean = (points: readonly Vec3[]): Vec3 =>
  mul(
    points.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]),
    1 / points.length,
  );

/** The camera's axes in the body frame, at pitch `VIEW_PITCH_DEG` below the horizon. */
const AXES = {
  forward: [Math.cos(PITCH), 0, -Math.sin(PITCH)] as Vec3,
  right: [0, -1, 0] as Vec3,
  up: [Math.sin(PITCH), 0, Math.cos(PITCH)] as Vec3,
};

/** The point `depth` metres ahead of `eye` along the view axis, `across` to its right and `up` above it. */
export function viewPoint(eye: Vec3, depth: number, across: number, up: number): Vec3 {
  return add(eye, add(mul(AXES.forward, depth), add(mul(AXES.right, across), mul(AXES.up, up))));
}

/** `point` in the camera's frame: metres to its right, above and ahead along the view axis. */
export function viewCoords(eye: Vec3, point: Vec3): { across: number; up: number; depth: number } {
  const rel = sub(point, eye);
  return { across: dot(rel, AXES.right), up: dot(rel, AXES.up), depth: dot(rel, AXES.forward) };
}

/** Metres above the view axis at `depth` for NDC y `ndc`. */
const heightAt = (ndc: number, depth: number): number => ndc * TAN_V * depth;

/** Reorders each face of a solid so that its normal points away from `inside`, or towards it when `towards`. */
function orient(
  verts: readonly Vec3[],
  faces: readonly (readonly number[])[],
  reference: Vec3,
  towards: boolean,
): number[][] {
  return faces.map((face) => {
    const points = face.map((i) => verts[i] as Vec3);
    const normal = cross(
      sub(points[1] as Vec3, points[0] as Vec3),
      sub(points[2] as Vec3, points[0] as Vec3),
    );
    const outward = dot(normal, sub(mean(points), reference));
    const flip = towards ? outward > 0 : outward < 0;
    return flip ? [...face].reverse() : [...face];
  });
}

const rounded = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];

function solid(
  hue: RealismHueKey,
  verts: readonly Vec3[],
  faces: readonly (readonly number[])[],
): Solid {
  return { hue, verts: verts.map(rounded), faces };
}

const CUBE_FACES = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
];

/** A hexahedron from its bottom ring and top ring, each a convex quad in the same order; faces point outward. */
function hexahedron(hue: RealismHueKey, bottom: readonly Vec3[], top: readonly Vec3[]): Solid {
  const verts = [...bottom, ...top];
  return solid(hue, verts, orient(verts, CUBE_FACES, mean(verts), false));
}

/** `CUBE_FACES` index of the face at the lower and upper end of each axis, for `box`'s `omit`. */
const FACE = { z0: 0, z1: 1, y0: 2, x1: 3, y1: 4, x0: 5 } as const;

/** A box; its faces named in `omit` are left out, where nothing ever sees them from the cab. */
function box(
  hue: RealismHueKey,
  x: readonly [number, number],
  y: readonly [number, number],
  z: readonly [number, number],
  omit: readonly number[] = [],
): Solid {
  const ring = (w: number): Vec3[] => [
    [x[0], y[0], w],
    [x[1], y[0], w],
    [x[1], y[1], w],
    [x[0], y[1], w],
  ];
  const bottom = ring(z[0]);
  const top = ring(z[1]);
  const verts = [...bottom, ...top];
  const faces = orient(verts, CUBE_FACES, mean(verts), false).filter((_, i) => !omit.includes(i));
  return solid(hue, verts, faces);
}

/** A box centred at `centre` with half sizes along the orthonormal `axes`. */
function orientedBox(
  hue: RealismHueKey,
  centre: Vec3,
  axes: readonly [Vec3, Vec3, Vec3],
  half: Vec3,
): Solid {
  const corner = (a: number, b: number, c: number): Vec3 =>
    add(
      centre,
      add(mul(axes[0], a * half[0]), add(mul(axes[1], b * half[1]), mul(axes[2], c * half[2]))),
    );
  return hexahedron(
    hue,
    [corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1)],
    [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)],
  );
}

type Anchors = ReturnType<typeof anchorsOf>;

function anchorsOf(spec: TruckSpec) {
  const { eye, frontX } = truckAnchors(spec);
  const cab = cabShellParams(spec);
  const half = cab.width / 2;
  const sill = FRAME_TOP + cab.cab.glassSill;
  return {
    eye: [eye.x, eye.y, eye.z] as Vec3,
    front: frontX,
    glass: frontX - GLASS_SETBACK,
    half,
    screen: half - cab.cab.windscreenInset,
    sideFront: frontX - cab.cab.sideGlassSetback,
    inner: half - DOOR_THICKNESS,
    sill,
    glassTop: sill + cab.cab.glassHeight,
    rear: frontX - cab.cabLength,
  };
}

/** NDC y of the dash's rear edge at `across` metres to the right of the eye, binnacle included. */
export function dashEdgeNdc(across: number): number {
  const flank = DASH.edge + DASH.flank * (across / DASH.flankScale) ** 2;
  const hump = HUMP.top - HUMP.drop * (Math.abs(across) / HUMP.halfWidth) ** 4;
  return Math.max(flank, hump);
}

/** Lateral samples (metres right of the eye) from `left` to `right`: fine across the binnacle, coarser beside it. */
function samples(left: number, right: number): number[] {
  const found = new Set<number>([left, right]);
  for (let a = -0.45; a <= 0.45 + 1e-9; a += 0.05) found.add(round(a));
  for (let a = -1.2; a <= 2 + 1e-9; a += 0.2) if (a > left && a < right) found.add(round(a));
  return [...found].filter((a) => a >= left && a <= right).sort((a, b) => a - b);
}

/** Height of the door tops: the sill, raised towards the driver but never above the eye. */
const doorTop = (a: Anchors, x: number): number =>
  Math.min(
    a.sill +
      DOOR_TOP_OVER_SILL +
      (DOOR_RISE * Math.max(0, a.glass - x)) / Math.max(1e-6, a.glass - a.eye[0] + 0.2),
    a.eye[2],
  );

function dash(a: Anchors): Solid[] {
  const [ex, ey, ez] = a.eye;
  const left = -(a.inner - ey);
  const right = a.inner + ey;
  const across = samples(left, right);
  const rear = across.map((s) =>
    viewPoint(a.eye, DASH.depth, s, heightAt(dashEdgeNdc(s), DASH.depth)),
  );
  // The front stays under the cone's lower edge, and the sill.
  const front = a.glass - ex;
  const coneFront =
    ez - front * Math.tan(rad(CLEAR_CONE_HALF_DEG + VIEW_PITCH_DEG + CONE_MARGIN_DEG));
  const frontZ = Math.min(a.sill, coneFront);
  const top: Vec3[] = [];
  const topFaces: number[][] = [];
  const faceFaces: number[][] = [];
  const face: Vec3[] = [];
  rear.forEach((r, i) => {
    top.push(r, [a.glass, r[1], frontZ]);
    face.push(r, [r[0], r[1], DASH_BOTTOM]);
    if (i === 0) return;
    const k = 2 * i;
    topFaces.push([k - 2, k - 1, k + 1], [k - 2, k + 1, k]);
    faceFaces.push([k - 2, k - 1, k + 1], [k - 2, k + 1, k]);
  });
  return [
    solid('anthracite', top, orient(top, topFaces, a.eye, true)),
    solid('chevronBlack', face, orient(face, faceFaces, a.eye, true)),
  ];
}

function doors(a: Anchors): Solid[] {
  const [ex] = a.eye;
  const back = ex - DOOR_BACK;
  const bottom = 1.55;
  return ([-1, 1] as const).map((side) => {
    const y: [number, number] = side > 0 ? [a.inner, a.half] : [-a.half, -a.inner];
    const ring = (x: number, z: number): Vec3[] => [
      [x, y[0], z],
      [x, y[1], z],
    ];
    const lo = (x: number): Vec3[] => ring(x, bottom);
    const hi = (x: number): Vec3[] => ring(x, doorTop(a, x));
    return hexahedron(
      'anthracite',
      [...lo(back), ...[...lo(a.glass)].reverse()],
      [...hi(back), ...[...hi(a.glass)].reverse()],
    );
  });
}

/** The shade band over the windscreen, the roof lining behind it and the stowed visor over the driver. */
function header(a: Anchors): Solid[] {
  const [ex, ey] = a.eye;
  const ceiling = CAB_HEIGHT - ROOF_LINING;
  const ahead = a.front - ex;
  const edgeZ = a.eye[2] + ahead * Math.tan(Math.atan(HEADER.bottomNdc * TAN_V) - PITCH);
  const bottom = Math.min(edgeZ, a.glassTop);
  const parts: Solid[] = [
    box('headliner', [ex - 0.4, a.front], [-a.inner, a.inner], [ceiling, ceiling + 0.02]),
  ];
  if (bottom < ceiling) {
    parts.push(
      box(
        'headliner',
        [a.front - HEADER.thickness, a.front],
        [-a.inner, a.inner],
        [bottom, ceiling],
      ),
    );
  }
  const visor = viewPoint(a.eye, VISOR.depth, 0, heightAt(VISOR.bottomNdc, VISOR.depth));
  if (visor[2] < ceiling) {
    parts.push(
      box(
        'anthracite',
        [visor[0], visor[0] + VISOR.thickness],
        [ey - VISOR.right, ey + VISOR.left],
        [visor[2], ceiling],
      ),
    );
  }
  return parts;
}

function wheel(a: Anchors): Solid[] {
  const { depth, radius, tubeRadius, tilt, segments } = WHEEL;
  // Rim top at `topNdc` at its own depth: hub height follows from the tilt.
  const topDepth = depth + radius * Math.sin(tilt);
  const topUp = heightAt(WHEEL.topNdc, topDepth);
  const hub = viewPoint(a.eye, depth, 0, topUp - radius * Math.cos(tilt));
  const right = AXES.right;
  // In-plane "up" tilts away from the driver by `tilt`; the plane's normal faces the driver.
  const planeUp = add(mul(AXES.up, Math.cos(tilt)), mul(AXES.forward, Math.sin(tilt)));
  const normal = cross(right, planeUp);
  const parts: Solid[] = [];
  const mid = radius - tubeRadius;
  const step = (2 * Math.PI) / segments;
  const chord = mid * Math.tan(step / 2);
  for (let i = 0; i < segments; i++) {
    const angle = i * step;
    const radial = add(mul(right, Math.cos(angle)), mul(planeUp, Math.sin(angle)));
    const tangent = add(mul(right, -Math.sin(angle)), mul(planeUp, Math.cos(angle)));
    parts.push(
      orientedBox(
        'anthracite',
        add(hub, mul(radial, mid)),
        [radial, tangent, normal],
        [tubeRadius, chord + tubeRadius * 0.5, tubeRadius],
      ),
    );
  }
  for (const angle of [Math.PI / 2 + Math.PI / 3, Math.PI / 2 - Math.PI / 3, -Math.PI / 2]) {
    const radial = add(mul(right, Math.cos(angle)), mul(planeUp, Math.sin(angle)));
    const tangent = cross(normal, radial);
    parts.push(
      orientedBox(
        'anthracite',
        add(hub, mul(radial, mid / 2)),
        [radial, tangent, normal],
        [mid / 2, 0.012, 0.012],
      ),
    );
  }
  parts.push(orientedBox('chevronBlack', hub, [right, planeUp, normal], [0.05, 0.05, 0.03]));
  return parts;
}

/** Both A-pillars: from the windscreen's edge to the front edge of the side glass, floor to roof lining. */
function pillars(a: Anchors): Solid[] {
  const bottom = a.sill - 0.1;
  const top = CAB_HEIGHT - ROOF_LINING;
  return ([-1, 1] as const).map((side) => {
    const ring = (z: number): Vec3[] => [
      [a.glass, side * a.screen, z],
      [a.sideFront, side * a.half, z],
      [a.sideFront - PILLAR_DEPTH, side * a.half, z],
      [a.glass - PILLAR_DEPTH, side * a.screen, z],
    ];
    return hexahedron('anthracite', ring(bottom), ring(top));
  });
}

/**
 * The cab behind the forward view, as extra solids of the four meshes: the door lining on to the
 * B-pillar and the rear quarter panel behind it, the rail above the side window, the sill panel,
 * floor and bulkhead, the rear wall and the roof lining on to it. The window above the door and ahead of the
 * B-pillar stays open, like the glass of the cab shell.
 */
function lookAround(a: Anchors): Record<InteriorMeshName, Solid[]> {
  const [ex] = a.eye;
  const back = ex - DOOR_BACK;
  const bPillar = ex - B_PILLAR.behindEye;
  const quarterFront = bPillar - B_PILLAR.depth;
  // stand just inside the cab skin, which the sun shadow takes as the cab's own outside
  const outer = a.half - SKIN_GAP;
  const rear = a.rear + SKIN_GAP;
  const front = a.front - SKIN_GAP;
  const wall = rear + REAR_WALL;
  const doorBottom = 1.55;
  const lane = (side: 1 | -1, from: number, to: number): [number, number] =>
    side > 0 ? [from, to] : [-to, -from];
  const interior: Solid[] = [];
  const pillars: Solid[] = [];
  for (const side of [-1, 1] as const) {
    const lining = lane(side, a.inner, outer);
    const post = lane(side, a.inner - B_PILLAR.inset, outer);
    const skin = [side > 0 ? FACE.y1 : FACE.y0]; // the side facing the cab's skin
    interior.push(
      // the door on to the B-pillar, level with the forward door where they meet
      box('anthracite', [bPillar, back], lining, [doorBottom, doorTop(a, back)], skin),
      // the sill panel under the door, which the forward door leaves open below its bottom
      box('anthracite', [bPillar, a.glass], lining, [FRAME_TOP, doorBottom], skin),
      // the rear quarter panel behind the B-pillar, floor to roof lining
      box('anthracite', [wall, quarterFront], lining, [FRAME_TOP, ROOF_TOP], skin),
    );
    pillars.push(
      box('anthracite', [quarterFront, bPillar], post, [FRAME_TOP, ROOF_TOP], skin),
      // the rail over the side window, back from the eye plane; ahead of it the forward view keeps its sky
      box('anthracite', [bPillar, ex + EYE_PLANE_LAP], lining, [a.glassTop, ROOF_TOP], skin),
    );
  }
  interior.push(
    box(
      'headliner',
      [rear, wall],
      [-outer, outer],
      [FRAME_TOP, ROOF_TOP],
      [FACE.x0, FACE.y0, FACE.y1],
    ),
    box(
      'anthracite',
      [rear, front],
      [-a.inner, a.inner],
      [FRAME_TOP, FRAME_TOP + FLOOR],
      [FACE.x0, FACE.x1, FACE.z0],
    ),
    // the bulkhead under the dash, which the dash face leaves open below its bottom edge
    box('anthracite', [a.glass, front], [-a.inner, a.inner], [FRAME_TOP, DASH_BOTTOM], [FACE.x1]),
  );
  const header: Solid[] = [
    box('headliner', [rear, ex - 0.4], [-a.inner, a.inner], [CEILING, ROOF_TOP]),
    // the roof lining out to the cab's sides, over the rail; the forward view keeps its open corners
    box(
      'headliner',
      [rear, ex + EYE_PLANE_LAP],
      [-outer, -a.inner],
      [CEILING, ROOF_TOP],
      [FACE.y0],
    ),
    box('headliner', [rear, ex + EYE_PLANE_LAP], [a.inner, outer], [CEILING, ROOF_TOP], [FACE.y1]),
  ];
  return { interior, wheel: [], header, pillars };
}

export type InteriorShellParams = ReturnType<typeof interiorShellParams>;

/** The solids `lookAround` adds to each mesh, which come after those of the forward view. */
export function lookAroundSolids(spec: TruckSpec): Record<InteriorMeshName, readonly Solid[]> {
  return lookAround(anchorsOf(spec));
}

/** Inputs of `tools/blender/interior_shell.py`; see `InteriorMeshName` for the meshes it exports. */
export function interiorShellParams(spec: TruckSpec) {
  const a = anchorsOf(spec);
  const around = lookAround(a);
  const meshes: Record<InteriorMeshName, Solid[]> = {
    interior: [...dash(a), ...doors(a), ...around.interior],
    wheel: [...wheel(a), ...around.wheel],
    header: [...header(a), ...around.header],
    pillars: [...pillars(a), ...around.pillars],
  };
  const hues = Object.fromEntries(
    [...new Set(Object.values(meshes).flatMap((m) => m.map((s) => s.hue)))]
      .sort()
      .map((key) => [key, hex(REALISM_HUES[key])]),
  );
  return { id: spec.id, schema: 1, hues, meshes };
}
