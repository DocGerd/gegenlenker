import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  Matrix4,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import type { MudflapSpec, Param, TrailerSpec, TruckSpec } from '../contracts/vehicle';
import {
  CONTOUR_STRIP as STRIP,
  MARKER_HEIGHT,
  MARKER_LENGTH,
  MARKER_SPACING,
  MARKING_END_MARGIN as END_MARGIN,
} from './body-dims';
import { PLATE_RELIEF, RELIEF } from './cab-dims';
import { tint } from './environment';
import type { LowLoaderDeck } from './trailer-dims';
import { PLATE_TEXT, REALISM_HUES as HUE } from './realism-hues';
import { box, merge, wheelGeometry } from './vehicle-geometry';

/*
 * Perspective-only detail, built from the dimensions the visuals already derive from vehicle Params.
 * Everything stands a few centimetres proud of the face it sits on, so no two coplanar faces compete
 * in the depth buffer. The meshes go on SKY_LAYER: the top-down view never sees them.
 * The cab front (glass, grille, lamps, bumper) is built apart: its back faces would block the cockpit eye.
 */

const RELIEF_OVER = 0.05; // parts laid over a mark
const WHEEL_RELIEF = [0.01, 0.02, 0.035] as const; // sidewall, rim, hub
const WHEEL_RATIO = [0.9, 0.62, 0.22] as const; // of the tyre radius

const PLATE_WIDTH = 0.52; // EU standard plate
const PLATE_HEIGHT = 0.11;
const FLAP_THICKNESS = 0.02;
const FLAP_MARGIN = 0.04;

const m = (param: Param): number => param.value / 1000;

export type PlateSpot = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** +1 faces forward, -1 rearward. */
  readonly facing: 1 | -1;
};

type Range = readonly [number, number];

/** Lateral range on one side, `from` and `to` measured outward from the centreline. */
const lateral = (side: number, from: number, to: number): Range =>
  side > 0 ? [from, to] : [-to, -from];

type Sink = {
  add(geometry: BufferGeometry, hue: number): void;
  box(x: Range, y: Range, z: Range, hue: number): void;
};

/** Which build a part belongs to: both, only the procedural one, or only the one shown with a shell. */
type Only = 'procedural' | 'shell' | null;

function collector() {
  const parts: { readonly geometry: BufferGeometry; readonly only: Only }[] = [];
  const sink = (only: Only): Sink => {
    const add = (geometry: BufferGeometry, hue: number): void => {
      parts.push({ geometry: tint(geometry, new Color(hue)), only });
    };
    return { add, box: (x, y, z, hue) => add(box(x, y, z), hue) };
  };
  const build = (skip: Only): BufferGeometry =>
    merge(parts.filter((part) => part.only !== skip).map((part) => part.geometry));
  return {
    ...sink(null),
    only: (which: Exclude<Only, null>): Sink => sink(which),
    build: (): BufferGeometry => build('shell'),
    buildShell: (): BufferGeometry => build('procedural'),
  };
}

/** Body-frame box whose centre height runs from zc0 at x0 to zc1 at x1, sheared so its ends stay upright. */
function slopedBox(
  [x0, x1]: Range,
  [y0, y1]: Range,
  [zc0, zc1]: Range,
  height: number,
): BufferGeometry {
  const slope = (zc1 - zc0) / (x1 - x0);
  return new BoxGeometry(x1 - x0, height, y1 - y0)
    .applyMatrix4(new Matrix4().makeShear(slope, 0, 0, 0, 0, 0))
    .translate((x0 + x1) / 2, (zc0 + zc1) / 2, -(y0 + y1) / 2);
}

/** Height offset along x: linear between [x, dz] breakpoints sorted by x, constant beyond them. */
type Profile = readonly (readonly [number, number])[];

const FLAT: Profile = [];

function offsetAt(profile: Profile, x: number): number {
  const first = profile[0];
  if (first === undefined) return 0;
  let [px, pz] = first;
  if (x <= px) return pz;
  for (const [qx, qz] of profile.slice(1)) {
    if (x <= qx) return pz + ((qz - pz) * (x - px)) / (qx - px);
    [px, pz] = [qx, qz];
  }
  return pz;
}

/** Sidewall, rim and hub as discs standing proud of both tyre faces; centre at body (x, y, z). */
function wheelFaces(
  c: Sink,
  radius: number,
  width: number,
  [x, y, z]: readonly [number, number, number],
): void {
  const hues = [HUE.chevronBlack, HUE.whiteAluminium, HUE.chevronBlack] as const;
  hues.forEach((hue, i) => {
    c.add(
      wheelGeometry(radius * (WHEEL_RATIO[i] ?? 1), width + 2 * (WHEEL_RELIEF[i] ?? 0)).translate(
        x,
        z,
        -y,
      ),
      hue,
    );
  });
}

/** Rims for a wheel that steers: centred on the origin so a kingpin pivot can carry it. */
export function frontWheelDetail(radius: number, width: number): BufferGeometry {
  const c = collector();
  wheelFaces(c, radius, width, [0, 0, 0]);
  return c.build();
}

function mudflap(
  c: Sink,
  spec: MudflapSpec,
  axleX: number,
  y: number,
  halfWidth: number,
  radius: number,
  rearLimit: number,
  ceiling = Infinity,
): void {
  const front = axleX - radius - m(spec.gap);
  const top = Math.min(m(spec.clearance) + m(spec.height), ceiling);
  if (top <= m(spec.clearance)) return;
  c.box(
    [Math.max(front - FLAP_THICKNESS, rearLimit), front],
    [y - halfWidth, y + halfWidth],
    [m(spec.clearance), top],
    HUE.chevronBlack,
  );
}

/**
 * A yellow contour strip along both sides, with amber marker lamps straddling it; the strip's
 * centre follows `profile` (zc plus its offset), so it can run down a sloped deck.
 */
function sideMarking(
  c: Sink,
  [x0, x1]: Range,
  halfWidth: number,
  zc: number,
  room: number,
  profile: Profile = FLAT,
): void {
  profile.reduce((prev, [x]) => {
    if (x <= prev) throw new Error('sideMarking: the profile is not strictly increasing in x');
    return x;
  }, -Infinity);
  const half = Math.min(MARKER_HEIGHT, room) / 2;
  const count = Math.max(2, Math.ceil((x1 - x0) / MARKER_SPACING) + 1);
  const inner = profile.map(([x]) => x).filter((x) => x > x0 && x < x1);
  for (const side of [-1, 1]) {
    const across = lateral(side, halfWidth, halfWidth + RELIEF);
    let from = x0;
    for (const to of [...inner, x1]) {
      const span: Range = [from, to];
      from = to;
      const ends: Range = [zc + offsetAt(profile, span[0]), zc + offsetAt(profile, span[1])];
      if (ends[0] === ends[1]) {
        c.box(span, across, [ends[0] - STRIP / 2, ends[0] + STRIP / 2], HUE.contourSide);
      } else {
        c.add(slopedBox(span, across, ends, STRIP), HUE.contourSide);
      }
    }
    for (let i = 0; i < count; i++) {
      const x = x0 + MARKER_LENGTH + ((x1 - x0 - 2 * MARKER_LENGTH) * i) / (count - 1);
      const z = zc + offsetAt(profile, x);
      c.box(
        [x - MARKER_LENGTH / 2, x + MARKER_LENGTH / 2],
        lateral(side, halfWidth, halfWidth + RELIEF_OVER),
        [z - half, z + half],
        HUE.sideMarker,
      );
    }
  }
}

export type TruckDetailParams = {
  readonly spec: Pick<TruckSpec, 'cab' | 'bumperInset' | 'tailLamp' | 'mudflap'>;
  readonly halfWidth: number;
  readonly frontX: number;
  readonly rearX: number;
  readonly bodyFront: number;
  readonly frameTop: number;
  readonly floorTop: number;
  readonly railBottom: number;
  readonly rearAxleX: number;
  readonly rearTrack: number;
  readonly twinOffset: number;
  readonly twinWidth: number;
  readonly wheelRadius: number;
};

export function truckDetail(p: TruckDetailParams): {
  geometry: BufferGeometry;
  cabFront: BufferGeometry;
  plate: PlateSpot;
} {
  const c = collector();
  const cabFront = collector();
  const { cab, tailLamp } = p.spec;
  const hw = p.halfWidth;
  const front: Range = [p.frontX, p.frontX + RELIEF];
  const above = (sill: Param, height: Param): Range => [
    p.frameTop + m(sill),
    p.frameTop + m(sill) + m(height),
  ];
  const glass = above(cab.glassSill, cab.glassHeight);
  const lamps = above(cab.lampSill, cab.lampHeight);
  const windscreen = hw - m(cab.windscreenInset);

  cabFront.box(front, [-windscreen, windscreen], glass, HUE.anthracite);
  cabFront.box(
    front,
    [-m(cab.grilleWidth) / 2, m(cab.grilleWidth) / 2],
    above(cab.grilleSill, cab.grilleHeight),
    HUE.chevronBlack,
  );
  const headlampOuter = hw - m(cab.headlampInset);
  for (const side of [-1, 1]) {
    cabFront.box(
      [
        p.frontX - m(cab.sideGlassSetback) - m(cab.sideGlassLength),
        p.frontX - m(cab.sideGlassSetback),
      ],
      lateral(side, hw, hw + RELIEF),
      glass,
      HUE.anthracite,
    );
    cabFront.box(
      front,
      lateral(side, headlampOuter - m(cab.headlampWidth), headlampOuter),
      lamps,
      HUE.plateWhite,
    );
  }
  const bumper: Range = [p.railBottom, p.frameTop];
  const bumperHalf = hw - m(p.spec.bumperInset);
  cabFront.box(front, [-bumperHalf, bumperHalf], bumper, HUE.chevronBlack);

  const floor = p.floorTop - p.frameTop;
  sideMarking(
    c,
    [p.rearX + END_MARGIN, p.bodyFront - END_MARGIN],
    hw,
    p.frameTop + floor / 2,
    floor,
  );
  for (const side of [-1, 1]) {
    c.box(
      [p.rearX - RELIEF, p.rearX],
      lateral(side, hw - m(tailLamp.inset) - m(tailLamp.width), hw - m(tailLamp.inset)),
      above(tailLamp.sill, tailLamp.height),
      HUE.tailLamp,
    );
    const half = p.twinOffset + p.twinWidth / 2 + FLAP_MARGIN;
    mudflap(
      c,
      p.spec.mudflap,
      p.rearAxleX,
      (side * p.rearTrack) / 2,
      half,
      p.wheelRadius,
      p.rearX + RELIEF,
    );
    for (const twin of [-1, 1]) {
      wheelFaces(c, p.wheelRadius, p.twinWidth, [
        p.rearAxleX,
        (side * p.rearTrack) / 2 + twin * p.twinOffset,
        p.wheelRadius,
      ]);
    }
  }

  return {
    geometry: c.build(),
    cabFront: cabFront.build(),
    plate: { x: p.frontX + PLATE_RELIEF, y: 0, z: (bumper[0] + bumper[1]) / 2, facing: 1 },
  };
}

/** Slanted black stripes across a yellow bar, mirrored about the centreline into a chevron. */
function chevrons(c: Sink, x: Range, halfLength: number, zc: number, height: number): void {
  const width = height / 2;
  const pitch = width * 2;
  const geometry = (yc: number): BufferGeometry =>
    new BoxGeometry(x[1] - x[0], height, width)
      .applyMatrix4(new Matrix4().makeShear(0, 0, 0, yc >= 0 ? 1 : -1, 0, 0))
      .translate((x[0] + x[1]) / 2, zc, -yc);
  for (
    let yc = -halfLength + width / 2 + height / 2;
    yc + width / 2 + height / 2 <= halfLength;
    yc += pitch
  ) {
    c.add(geometry(yc), HUE.chevronBlack);
  }
}

export type TrailerDetailParams = {
  readonly spec: Pick<TrailerSpec, 'underrunGuard' | 'tailLamp' | 'mudflap'>;
  readonly halfWidth: number;
  readonly rearX: number;
  readonly frontX: number;
  readonly deck: number;
  readonly underside: number;
  readonly bodyTop: number;
  readonly isBox: boolean;
  readonly radius: number;
  readonly track: number;
  readonly wheelWidth: number;
  readonly rearAxleXs: readonly number[];
  /** The low-loader shell's deck, which the marking, rear contour and tail lamps follow with the shell on. */
  readonly shellDeck: LowLoaderDeck | null;
};

/**
 * `shellGeometry` is the detail shown with the trailer shell, or null when it is `geometry`. A bare
 * chassis drops what sits on a swap body's own faces (the side marking and the top and side strips);
 * a low-loader's marking, rear contour and tail lamps follow its sloped rear and lamp carrier.
 */
export function trailerDetail(p: TrailerDetailParams): {
  geometry: BufferGeometry;
  shellGeometry: BufferGeometry | null;
  plate: PlateSpot;
} {
  const c = collector();
  const deck = p.shellDeck;
  const replaced = c.only('procedural');
  const shellOnly = c.only('shell');
  const onBox = p.isBox ? replaced : c;
  const flat = deck === null ? c : replaced;
  const hw = p.halfWidth;
  const rear: Range = [p.rearX - RELIEF, p.rearX];
  const slab = p.deck - p.underside;
  const lowerZ = p.isBox ? p.deck + STRIP : (p.deck + p.underside) / 2;

  const { underrunGuard, tailLamp } = p.spec;
  const guard: Range = [
    m(underrunGuard.lowerEdge),
    m(underrunGuard.lowerEdge) + m(underrunGuard.height),
  ];
  const guardHalf = hw - m(underrunGuard.inset);
  const guardDepth: Range = [p.rearX, p.rearX + m(underrunGuard.depth)];
  c.box(guardDepth, [-guardHalf, guardHalf], guard, HUE.signalYellow);
  for (const side of [-1, 1]) {
    c.box(
      guardDepth,
      lateral(
        side,
        m(underrunGuard.strutOffset),
        m(underrunGuard.strutOffset) + m(underrunGuard.strutWidth),
      ),
      [guard[1], p.underside],
      HUE.chevronBlack,
    );
  }
  chevrons(
    c,
    [p.rearX - RELIEF, p.rearX],
    guardHalf,
    (guard[0] + guard[1]) / 2,
    guard[1] - guard[0],
  );

  const markingSpan: Range = [p.rearX + END_MARGIN, p.frontX - END_MARGIN];
  const markingRoom = p.isBox ? p.bodyTop - p.deck : slab;
  sideMarking(p.isBox ? onBox : flat, markingSpan, hw, lowerZ, markingRoom);
  const rearContour = (sink: Sink, z: number): void => {
    sink.box(rear, [-(hw - STRIP), hw - STRIP], [z - STRIP / 2, z + STRIP / 2], HUE.contourRear);
  };
  // the lower rear contour stays with a bare chassis: it sits on the lamp carrier
  rearContour(flat, lowerZ);
  if (deck !== null) {
    const drop = deck.rearDeck - p.deck;
    sideMarking(shellOnly, markingSpan, hw, lowerZ, markingRoom, [
      [deck.slopeEnd, drop],
      [deck.slopeStart, 0],
    ]);
    rearContour(shellOnly, deck.contourZ);
  }
  if (p.isBox) {
    const top = p.bodyTop - STRIP;
    onBox.box(
      rear,
      [-(hw - STRIP), hw - STRIP],
      [top - STRIP / 2, top + STRIP / 2],
      HUE.contourRear,
    );
    for (const side of [-1, 1]) {
      onBox.box(
        rear,
        lateral(side, hw - 2 * STRIP, hw - STRIP),
        [p.deck, p.bodyTop],
        HUE.contourRear,
      );
      onBox.box(
        [p.rearX + END_MARGIN, p.frontX - END_MARGIN],
        lateral(side, hw, hw + RELIEF),
        [top - STRIP / 2, top + STRIP / 2],
        HUE.contourSide,
      );
    }
  }

  const tailLamps = (sink: Sink, base: number, side: number): void => {
    sink.box(
      [p.rearX - RELIEF_OVER, p.rearX],
      lateral(side, hw - m(tailLamp.inset) - m(tailLamp.width), hw - m(tailLamp.inset)),
      [base + m(tailLamp.sill), base + m(tailLamp.sill) + m(tailLamp.height)],
      HUE.tailLamp,
    );
  };
  for (const side of [-1, 1]) {
    tailLamps(flat, p.deck, side);
    if (deck !== null) tailLamps(shellOnly, deck.rearDeck, side);
    for (const axleX of p.rearAxleXs) {
      const y = (side * p.track) / 2;
      // the flap ends under the deck rather than standing through it
      mudflap(
        c,
        p.spec.mudflap,
        axleX,
        y,
        p.wheelWidth / 2 + FLAP_MARGIN,
        p.radius,
        p.rearX + RELIEF,
        p.underside,
      );
      wheelFaces(c, p.radius, p.wheelWidth, [axleX, y, p.radius]);
    }
  }

  return {
    geometry: c.build(),
    shellGeometry: p.isBox || deck !== null ? c.buildShell() : null,
    plate: {
      x: p.rearX - PLATE_RELIEF,
      y: 0,
      z: (guard[0] + guard[1]) / 2,
      facing: -1,
    },
  };
}

export function dollyDetail(
  radius: number,
  width: number,
  frontAxleX: number,
  track: number,
): BufferGeometry {
  const c = collector();
  for (const side of [-1, 1])
    wheelFaces(c, radius, width, [frontAxleX, (side * track) / 2, radius]);
  return c.build();
}

export function plateGeometry({ x, y, z, facing }: PlateSpot): BufferGeometry {
  return new PlaneGeometry(PLATE_WIDTH, PLATE_HEIGHT)
    .rotateY((facing * Math.PI) / 2)
    .translate(x, z, -y);
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** The plate face, or null where there is no canvas (tests, workers). */
export function plateTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * PLATE_HEIGHT) / PLATE_WIDTH);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const band = canvas.height * 0.6;
  ctx.fillStyle = hex(HUE.plateWhite);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = hex(HUE.plateEuBlue);
  ctx.fillRect(0, 0, band, canvas.height);
  ctx.fillStyle = hex(HUE.plateEuStar);
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(
      band / 2 + Math.cos(angle) * band * 0.3,
      canvas.height * 0.4 + Math.sin(angle) * band * 0.3,
      band * 0.04,
      0,
      2 * Math.PI,
    );
    ctx.fill();
  }
  ctx.fillStyle = hex(HUE.plateInk);
  ctx.font = `bold ${Math.round(canvas.height * 0.7)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    PLATE_TEXT,
    band + (canvas.width - band) / 2,
    canvas.height / 2,
    canvas.width - band,
  );
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
