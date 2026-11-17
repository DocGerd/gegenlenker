import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  Matrix4,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { tint } from './environment';
import { PLATE_TEXT, REALISM_HUES as HUE } from './realism-hues';
import { box, merge, wheelGeometry } from './vehicle-geometry';

/*
 * Perspective-only detail, built from the dimensions the visuals already derive from vehicle Params.
 * Everything stands a few centimetres proud of the face it sits on, so no two coplanar faces compete
 * in the depth buffer. The meshes go on SKY_LAYER: the top-down view never sees them.
 */

const RELIEF = 0.03; // marks and lamps on a body face
const RELIEF_OVER = 0.05; // parts laid over a mark
const PLATE_RELIEF = 0.06;
const WHEEL_RELIEF = [0.01, 0.02, 0.035] as const; // sidewall, rim, hub
const WHEEL_RATIO = [0.9, 0.62, 0.22] as const; // of the tyre radius

const END_MARGIN = 0.1; // side marking stops short of the body ends
const STRIP = 0.06; // contour marking, ECE R48 asks at least 50 mm
const MARKER_LENGTH = 0.2;
const MARKER_HEIGHT = 0.1;
const MARKER_SPACING = 3; // ECE R48 maximum between side marker lamps
const PLATE_WIDTH = 0.52; // EU standard plate
const PLATE_HEIGHT = 0.11;
const FLAP_THICKNESS = 0.02;
const FLAP_GAP = 0.1; // behind the tyre
const FLAP_MARGIN = 0.04;
const GUARD_DEPTH = 0.05;
const GUARD_INSET = 0.1;
const GUARD_RATIO = [0.6, 1.1] as const; // lower and upper edge, of the wheel radius
const FLAP_RATIO = [0.25, 1.9] as const;

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

function collector() {
  const parts: BufferGeometry[] = [];
  const add = (geometry: BufferGeometry, hue: number): void => {
    parts.push(tint(geometry, new Color(hue)));
  };
  return {
    add,
    box: (x: Range, y: Range, z: Range, hue: number): void => add(box(x, y, z), hue),
    build: (): BufferGeometry => merge(parts),
  };
}

type Collector = ReturnType<typeof collector>;

/** Sidewall, rim and hub as discs standing proud of both tyre faces; centre at body (x, y, z). */
function wheelFaces(
  c: Collector,
  radius: number,
  width: number,
  [x, y, z]: readonly [number, number, number],
): void {
  const hues = [HUE.anthracite, HUE.whiteAluminium, HUE.anthracite] as const;
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
  c: Collector,
  axleX: number,
  y: number,
  halfWidth: number,
  radius: number,
  rearLimit: number,
): void {
  const front = axleX - radius - FLAP_GAP;
  c.box(
    [Math.max(front - FLAP_THICKNESS, rearLimit), front],
    [y - halfWidth, y + halfWidth],
    [radius * FLAP_RATIO[0], radius * FLAP_RATIO[1]],
    HUE.chevronBlack,
  );
}

/** A yellow contour strip along both sides, with amber marker lamps straddling it. */
function sideMarking(
  c: Collector,
  [x0, x1]: Range,
  halfWidth: number,
  zc: number,
  room: number,
): void {
  const half = Math.min(MARKER_HEIGHT, room) / 2;
  const count = Math.max(2, Math.ceil((x1 - x0) / MARKER_SPACING) + 1);
  for (const side of [-1, 1]) {
    c.box(
      [x0, x1],
      lateral(side, halfWidth, halfWidth + RELIEF),
      [zc - STRIP / 2, zc + STRIP / 2],
      HUE.contourSide,
    );
    for (let i = 0; i < count; i++) {
      const x = x0 + MARKER_LENGTH + ((x1 - x0 - 2 * MARKER_LENGTH) * i) / (count - 1);
      c.box(
        [x - MARKER_LENGTH / 2, x + MARKER_LENGTH / 2],
        lateral(side, halfWidth, halfWidth + RELIEF_OVER),
        [zc - half, zc + half],
        HUE.sideMarker,
      );
    }
  }
}

export type TruckDetailParams = {
  readonly halfWidth: number;
  readonly frontX: number;
  readonly rearX: number;
  readonly cabRear: number;
  readonly bodyFront: number;
  readonly cabTop: number;
  readonly frameTop: number;
  readonly floorTop: number;
  readonly railBottom: number;
  readonly rearAxleX: number;
  readonly rearTrack: number;
  readonly twinOffset: number;
  readonly twinWidth: number;
  readonly wheelRadius: number;
};

export function truckDetail(p: TruckDetailParams): { geometry: BufferGeometry; plate: PlateSpot } {
  const c = collector();
  const hw = p.halfWidth;
  const span = p.cabTop - p.frameTop;
  const cabLength = p.frontX - p.cabRear;
  const front: Range = [p.frontX, p.frontX + RELIEF];
  const glass: Range = [p.frameTop + 0.5 * span, p.frameTop + 0.92 * span];
  const lamps: Range = [p.frameTop + 0.1 * span, p.frameTop + 0.32 * span];

  c.box(front, [-0.88 * hw, 0.88 * hw], glass, HUE.anthracite);
  c.box(
    front,
    [-0.5 * hw, 0.5 * hw],
    [p.frameTop + 0.08 * span, p.frameTop + 0.38 * span],
    HUE.chevronBlack,
  );
  for (const side of [-1, 1]) {
    c.box(
      [p.frontX - 0.45 * cabLength, p.frontX - 0.08 * cabLength],
      lateral(side, hw, hw + RELIEF),
      glass,
      HUE.anthracite,
    );
    c.box(front, lateral(side, 0.58 * hw, 0.9 * hw), lamps, HUE.plateWhite);
  }
  const bumper: Range = [p.railBottom, p.frameTop];
  c.box(front, [-(hw - GUARD_INSET), hw - GUARD_INSET], bumper, HUE.anthracite);

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
      lateral(side, 0.7 * hw, 0.92 * hw),
      [p.frameTop + 0.1 * floor, p.frameTop + 0.9 * floor],
      HUE.tailLamp,
    );
    const half = p.twinOffset + p.twinWidth / 2 + FLAP_MARGIN;
    mudflap(c, p.rearAxleX, (side * p.rearTrack) / 2, half, p.wheelRadius, p.rearX + RELIEF);
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
    plate: { x: p.frontX + PLATE_RELIEF, y: 0, z: (bumper[0] + bumper[1]) / 2, facing: 1 },
  };
}

/** Slanted black stripes across a yellow bar, mirrored about the centreline into a chevron. */
function chevrons(c: Collector, x: Range, halfLength: number, zc: number, height: number): void {
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
  /** Lateral range (outward from the centreline) and height of each tail lamp. */
  readonly tailLampY: Range;
  readonly tailLampZ: Range;
};

export function trailerDetail(p: TrailerDetailParams): {
  geometry: BufferGeometry;
  plate: PlateSpot;
} {
  const c = collector();
  const hw = p.halfWidth;
  const rear: Range = [p.rearX - RELIEF, p.rearX];
  const slab = p.deck - p.underside;
  const lowerZ = p.isBox ? p.deck + STRIP : (p.deck + p.underside) / 2;

  const guard: Range = [p.radius * GUARD_RATIO[0], p.radius * GUARD_RATIO[1]];
  const guardHalf = hw - GUARD_INSET;
  c.box([p.rearX, p.rearX + GUARD_DEPTH], [-guardHalf, guardHalf], guard, HUE.signalYellow);
  for (const side of [-1, 1]) {
    c.box(
      [p.rearX, p.rearX + GUARD_DEPTH],
      lateral(side, 0.5 * hw, 0.5 * hw + 2 * GUARD_DEPTH),
      [guard[1], p.underside],
      HUE.anthracite,
    );
  }
  chevrons(
    c,
    [p.rearX - RELIEF, p.rearX],
    guardHalf,
    (guard[0] + guard[1]) / 2,
    guard[1] - guard[0],
  );

  sideMarking(
    c,
    [p.rearX + END_MARGIN, p.frontX - END_MARGIN],
    hw,
    lowerZ,
    p.isBox ? p.bodyTop - p.deck : slab,
  );
  c.box(
    rear,
    [-(hw - STRIP), hw - STRIP],
    [lowerZ - STRIP / 2, lowerZ + STRIP / 2],
    HUE.contourRear,
  );
  if (p.isBox) {
    const top = p.bodyTop - STRIP;
    c.box(rear, [-(hw - STRIP), hw - STRIP], [top - STRIP / 2, top + STRIP / 2], HUE.contourRear);
    for (const side of [-1, 1]) {
      c.box(rear, lateral(side, hw - 2 * STRIP, hw - STRIP), [p.deck, p.bodyTop], HUE.contourRear);
      c.box(
        [p.rearX + END_MARGIN, p.frontX - END_MARGIN],
        lateral(side, hw, hw + RELIEF),
        [top - STRIP / 2, top + STRIP / 2],
        HUE.contourSide,
      );
    }
  }

  for (const side of [-1, 1]) {
    c.box(
      [p.rearX - RELIEF_OVER, p.rearX],
      lateral(side, ...p.tailLampY),
      p.tailLampZ,
      HUE.tailLamp,
    );
    for (const axleX of p.rearAxleXs) {
      const y = (side * p.track) / 2;
      mudflap(c, axleX, y, p.wheelWidth / 2 + FLAP_MARGIN, p.radius, p.rearX + RELIEF);
      wheelFaces(c, p.radius, p.wheelWidth, [axleX, y, p.radius]);
    }
  }

  return {
    geometry: c.build(),
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
