import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import {
  bodyFrontX,
  CONTOUR_STRIP as STRIP,
  FLOOR_TOP,
  MARKER_HEIGHT,
  MARKER_LENGTH,
  MARKER_SPACING,
  MARKING_END_MARGIN as END_MARGIN,
  markingBand,
} from './body-dims';
import { CAB_LENGTH, FRAME_TOP, hex, metres, RELIEF, round } from './cab-dims';
import { TRAILER_LOOKS } from './livery';
import { REALISM_HUES as HUE } from './realism-hues';
import {
  ARM_WIDTH,
  DRAWBAR_SPREAD,
  LAFETTE,
  lafetteGuard,
  lowLoaderDeck,
  RAMP_GAP,
  RAMP_HEIGHT,
  RAMP_WIDTH,
  SWAP_BODY_HEIGHT,
  trailerFrame,
} from './trailer-dims';

// No `three` import: scripts/glb-params.mjs loads this module under plain Node.

/*
 * Every vehicle lamp (UN R48), in the frame of the rigid part that carries it: the truck body frame
 * for `cab` and `body`, the trailer body frame for `trailer`, the dolly frame for `dolly`. The
 * procedural detail, the shells' lens objects and the R48 test all read these lists.
 */

export type LampFn =
  | 'dipped-beam'
  | 'front-position'
  | 'front-indicator'
  | 'side-indicator'
  | 'side-marker'
  | 'end-outline-front'
  | 'end-outline-rear'
  | 'rear-position'
  | 'stop'
  | 'rear-indicator'
  | 'reversing'
  | 'rear-fog'
  | 'rear-plate';

export type LampColour = 'white' | 'red' | 'amber';

/** UN R48 5.15. */
export const LAMP_COLOURS: Readonly<Record<LampFn, LampColour>> = {
  'dipped-beam': 'white',
  'front-position': 'white',
  'front-indicator': 'amber',
  'side-indicator': 'amber',
  'side-marker': 'amber',
  'end-outline-front': 'white',
  'end-outline-rear': 'red',
  'rear-position': 'red',
  stop: 'red',
  'rear-indicator': 'amber',
  reversing: 'white',
  'rear-fog': 'red',
  'rear-plate': 'white',
};

export type LampPart = 'cab' | 'body' | 'trailer' | 'dolly';
export type LampFacing = 'front' | 'rear' | 'left' | 'right';
export type Range = readonly [number, number];
export type Box3 = readonly [x: Range, y: Range, z: Range];

export type Lamp = {
  readonly id: string;
  /** One lens can carry several functions, such as a combined rear position and stop lamp. */
  readonly fns: readonly LampFn[];
  readonly side: -1 | 0 | 1;
  readonly part: LampPart;
  readonly facing: LampFacing;
  /** The lens; its face towards the part touches the surface it sits on. */
  readonly box: Box3;
  /** Unlit lens colour, sRGB. */
  readonly hue: number;
  /** With the shell on, the shell's lens object draws it; otherwise the procedural detail does. */
  readonly shell: boolean;
  /** What carries it: the part's own surface (a shell face or the procedural body), or a detail part. */
  readonly seat: 'part' | 'detail';
};

/** A carrier for lamps where the part has no face; drawn by whoever draws its lamps. */
export type Bracket = { readonly part: LampPart; readonly box: Box3; readonly shell: boolean };

export type LampLayout = { readonly lamps: readonly Lamp[]; readonly brackets: readonly Bracket[] };

export const LENS_DEPTH = 0.05; // rear and side lenses stand this far proud
export const FRONT_LENS_DEPTH = 0.02; // front lenses stay behind the front plate
/** Headlamp unit chambers, outboard first, as shares of `cab.headlampWidth`. */
export const HEADLAMP_CHAMBERS = [
  [['front-indicator'], 0.2],
  [['front-position'], 0.15],
  [['dipped-beam'], 0.65],
] as const satisfies readonly (readonly [readonly LampFn[], number])[];
/** Rear cluster chambers, outboard first, as shares of `tailLamp.width`; reversing keeps fog and stop apart. */
export const TAIL_CHAMBERS = [
  [['rear-indicator'], 0.25],
  [['rear-position', 'stop'], 0.25],
  [['reversing'], 0.3],
  [['rear-fog'], 0.2],
] as const satisfies readonly (readonly [readonly LampFn[], number])[];
export const SMALL_LAMP = { width: 0.08, height: 0.05 } as const; // end-outline markers, repeaters
const FRONT_MARKER_INSET = 0.13; // cab front end-outline marker, clear of the chamfered corners
const FRONT_MARKER_ABOVE_GLASS = 0.015;
const REPEATER = { behindFront: 1.75, aboveFrame: 0.25 } as const; // cat 6 side indicator
const CAB_MARKER_BEHIND_FRONT = 2.9; // rear edge, inside R48 6.18.4.3's 3 m
const SIDE_MARKER_REACH = 3; // R48 6.18.4.3, foremost marker from the front
const TRAILER_FRONT = { bracket: 0.1, inset: 0.005, gap: 0.01 } as const;
const DOLLY_MARKER = { behindKink: 0.3, bracket: 0.05, relief: 0.02 } as const;
const REAR_CORNER = { length: 0.3, width: 0.1, height: 0.12 } as const; // lafette rear side marker block
const PLATE_LAMP = { halfWidth: 0.06, height: 0.03, belowGuardTop: 0.01 } as const;

const lateral = (side: number, from: number, to: number): Range =>
  side > 0 ? [from, to] : [-to, -from];
const r = ([a, b]: Range): Range => [round(a), round(b)];
const boxOf = (x: Range, y: Range, z: Range): Box3 => [r(x), r(y), r(z)];
const SIDES = [1, -1] as const;
const sideName = (side: number): string => (side > 0 ? 'left' : 'right');

/** Marker centres along [x0, x1], as the procedural side marking spaces them. */
export function markerXs(x0: number, x1: number): number[] {
  const count = Math.max(2, Math.ceil((x1 - x0) / MARKER_SPACING) + 1);
  return Array.from(
    { length: count },
    (_, i) => x0 + MARKER_LENGTH + ((x1 - x0 - 2 * MARKER_LENGTH) * i) / (count - 1),
  );
}

/** Height offset along x: linear between [x, dz] breakpoints sorted by x, constant beyond them. */
export type Profile = readonly (readonly [number, number])[];

export function offsetAt(profile: Profile, x: number): number {
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

/** A side contour run: its span, centre height, the room it has and the slope it follows. */
export type SideRun = {
  readonly span: Range;
  readonly zc: number;
  readonly room: number;
  readonly profile: Profile;
};

type Sink = { lamps: Lamp[]; brackets: Bracket[] };

function addChambers(
  sink: Sink,
  prefix: string,
  chambers: readonly (readonly [readonly LampFn[], number])[],
  outer: number,
  width: number,
  base: Omit<Lamp, 'id' | 'fns' | 'side' | 'box'>,
  x: Range,
  z: Range,
): void {
  for (const side of SIDES) {
    let from = outer;
    chambers.forEach(([fns, share], i) => {
      const to = from - width * share;
      sink.lamps.push({
        ...base,
        id: `${prefix}-${i}-${sideName(side)}`,
        fns,
        side,
        box: boxOf(x, lateral(side, to, from), z),
      });
      from = to;
    });
  }
}

function sideMarkers(
  sink: Sink,
  prefix: string,
  run: SideRun,
  hw: number,
  fns: readonly LampFn[],
  part: LampPart,
  shell: boolean,
  relief = LENS_DEPTH,
  y = hw,
): void {
  const half = Math.min(MARKER_HEIGHT, run.room) / 2;
  const xs = markerXs(...run.span);
  for (const side of SIDES) {
    xs.forEach((x, i) => {
      // on a slope the box rises to its higher end, so it stays on the sloped face
      const z =
        run.zc +
        Math.max(
          offsetAt(run.profile, x - MARKER_LENGTH / 2),
          offsetAt(run.profile, x + MARKER_LENGTH / 2),
        );
      sink.lamps.push({
        id: `${prefix}-${i}-${sideName(side)}`,
        fns,
        side,
        part,
        facing: side > 0 ? 'left' : 'right',
        box: boxOf([x - MARKER_LENGTH / 2, x + MARKER_LENGTH / 2], lateral(side, y, y + relief), [
          z - half,
          z + half,
        ]),
        hue: HUE.sideMarker,
        shell,
        seat: 'part',
      });
    });
  }
}

/** The truck body's side marking; `cabLength` is the cab it sits behind. */
export function truckSideRun(spec: TruckSpec, cabLength = CAB_LENGTH): SideRun {
  const a = truckAnchors(spec);
  const band = markingBand();
  return {
    span: [a.rearX + END_MARGIN, bodyFrontX(a.frontX, cabLength) - END_MARGIN],
    zc: (band.zLow + band.zHigh) / 2,
    room: FLOOR_TOP - FRAME_TOP,
    profile: [],
  };
}

/** Truck lamps with the body behind a cab of `cabLength`: the top-down cab, or a longer shell cab. */
export function truckLamps(spec: TruckSpec, cabLength = CAB_LENGTH): LampLayout {
  const a = truckAnchors(spec);
  const hw = metres(spec.width) / 2;
  const { cab, tailLamp } = spec;
  const front = a.frontX;
  const rear = a.rearX;
  const sink: Sink = { lamps: [], brackets: [] };
  const cabLamp = { part: 'cab', facing: 'front', shell: true, seat: 'part' } as const;

  // headlamp units in the bumper, whose face is at front + RELIEF
  const lampZ: Range = [
    FRAME_TOP + metres(cab.lampSill),
    FRAME_TOP + metres(cab.lampSill) + metres(cab.lampHeight),
  ];
  addChambers(
    sink,
    'headlamp',
    HEADLAMP_CHAMBERS,
    hw - metres(cab.headlampInset),
    metres(cab.headlampWidth),
    { ...cabLamp, hue: HUE.plateWhite },
    [front + RELIEF, front + RELIEF + FRONT_LENS_DEPTH],
    lampZ,
  );

  const glassTop = FRAME_TOP + metres(cab.glassSill) + metres(cab.glassHeight);
  const markerTop = glassTop + FRONT_MARKER_ABOVE_GLASS;
  for (const side of SIDES) {
    const outer = hw - FRONT_MARKER_INSET;
    sink.lamps.push({
      ...cabLamp,
      id: `end-outline-front-${sideName(side)}`,
      fns: ['end-outline-front'],
      side,
      box: boxOf(
        [front, front + RELIEF + FRONT_LENS_DEPTH],
        lateral(side, outer - SMALL_LAMP.width, outer),
        [markerTop - SMALL_LAMP.height, markerTop],
      ),
      hue: HUE.plateWhite,
    });
    const z = FRAME_TOP + REPEATER.aboveFrame;
    sink.lamps.push({
      ...cabLamp,
      id: `side-indicator-${sideName(side)}`,
      fns: ['side-indicator'],
      side,
      facing: side > 0 ? 'left' : 'right',
      box: boxOf(
        [front - REPEATER.behindFront, front - REPEATER.behindFront + SMALL_LAMP.width],
        lateral(side, hw, hw + LENS_DEPTH),
        [z, z + SMALL_LAMP.height],
      ),
      hue: HUE.sideMarker,
    });
  }

  const run = truckSideRun(spec, cabLength);
  sideMarkers(sink, 'side-marker', run, hw, ['side-marker'], 'body', false);
  const foremost = Math.max(...markerXs(...run.span)) - MARKER_LENGTH / 2;
  if (front - foremost > SIDE_MARKER_REACH) {
    // a long cab pushes the body back: one more marker on the cab side
    const x0 = front - CAB_MARKER_BEHIND_FRONT;
    if (x0 < front - cabLength) throw new Error(`truckLamps: no cab side for ${spec.id}'s marker`);
    const half = Math.min(MARKER_HEIGHT, run.room) / 2;
    for (const side of SIDES) {
      sink.lamps.push({
        ...cabLamp,
        id: `side-marker-cab-${sideName(side)}`,
        fns: ['side-marker'],
        side,
        facing: side > 0 ? 'left' : 'right',
        box: boxOf([x0, x0 + MARKER_LENGTH], lateral(side, hw, hw + LENS_DEPTH), [
          run.zc - half,
          run.zc + half,
        ]),
        hue: HUE.sideMarker,
      });
    }
  }

  const bodyLamp = { part: 'body', facing: 'rear', shell: false, seat: 'part' } as const;
  const rearX: Range = [rear - LENS_DEPTH, rear];
  addChambers(
    sink,
    'tail',
    TAIL_CHAMBERS,
    hw - metres(tailLamp.inset),
    metres(tailLamp.width),
    { ...bodyLamp, hue: HUE.tailLamp },
    rearX,
    [
      FRAME_TOP + metres(tailLamp.sill),
      FRAME_TOP + metres(tailLamp.sill) + metres(tailLamp.height),
    ],
  );
  for (const side of SIDES) {
    const outer = hw - STRIP;
    sink.lamps.push({
      ...bodyLamp,
      id: `end-outline-rear-${sideName(side)}`,
      fns: ['end-outline-rear'],
      side,
      box: boxOf(rearX, lateral(side, outer - SMALL_LAMP.width, outer), [
        FLOOR_TOP - STRIP / 2 - SMALL_LAMP.height,
        FLOOR_TOP - STRIP / 2,
      ]),
      hue: HUE.tailLamp,
    });
  }
  return sink;
}

export type LampVariant = 'procedural' | 'shell';

/** The trailer's side marking in `variant`: on the swap body, the deck slab or the lafette's side guard. */
export function trailerSideRun(spec: TrailerSpec, variant: LampVariant): SideRun {
  const f = trailerFrame(spec);
  const kind = TRAILER_LOOKS[spec.id].kind;
  if (variant === 'shell' && kind === 'lafette') {
    const guard = lafetteGuard(spec);
    const [b0, b1] = LAFETTE.guardBars[1];
    return {
      span: [guard.span[0] + END_MARGIN, guard.span[1] - END_MARGIN],
      zc: (b0 + b1) / 2,
      room: MARKER_HEIGHT,
      profile: [],
    };
  }
  const deck = variant === 'shell' && kind === 'low-loader' ? lowLoaderDeck(spec) : null;
  return {
    span: [f.a.rearX + END_MARGIN, f.a.frontX - END_MARGIN],
    zc: f.isBox ? f.deck + STRIP : (f.deck + f.underside) / 2,
    room: f.isBox ? SWAP_BODY_HEIGHT : f.deck - f.underside,
    profile:
      deck === null
        ? []
        : [
            [deck.slopeEnd, deck.rearDeck - f.deck],
            [deck.slopeStart, 0],
          ],
  };
}

/**
 * Trailer lamps in `variant`: the procedural trailer, or its shell (a lafette or a low-loader deck).
 * Amber side markers flash with the indicators, which R48 6.5.3.1 accepts instead of cat 5 lamps.
 */
export function trailerLamps(spec: TrailerSpec, variant: LampVariant): LampLayout {
  const f = trailerFrame(spec);
  const { a, hw, deck, underside, isBox } = f;
  const kind = TRAILER_LOOKS[spec.id].kind;
  const lafette = variant === 'shell' && kind === 'lafette';
  const lowDeck = variant === 'shell' && kind === 'low-loader' ? lowLoaderDeck(spec) : null;
  const sink: Sink = { lamps: [], brackets: [] };
  const markerFns = ['side-marker', 'side-indicator'] as const;
  const lamp = (l: Omit<Lamp, 'shell' | 'seat'> & Partial<Pick<Lamp, 'shell' | 'seat'>>): void => {
    sink.lamps.push({ shell: false, seat: 'part', ...l });
  };

  // front: position and end-outline markers side by side at each corner
  const frontZ: Range = isBox
    ? [deck - TRAILER_FRONT.bracket + 0.02, deck - 0.03]
    : [
        (deck + underside) / 2 - SMALL_LAMP.height / 2,
        (deck + underside) / 2 + SMALL_LAMP.height / 2,
      ];
  for (const side of SIDES) {
    if (isBox) {
      sink.brackets.push({
        part: 'trailer',
        box: boxOf(
          [a.frontX - TRAILER_FRONT.bracket, a.frontX],
          lateral(side, hw - TRAILER_FRONT.bracket, hw),
          [deck - TRAILER_FRONT.bracket, deck],
        ),
        shell: false,
      });
    }
    const seat = isBox ? 'detail' : 'part';
    const x: Range = [a.frontX, a.frontX + LENS_DEPTH];
    const outline = hw - TRAILER_FRONT.inset;
    const width = (TRAILER_FRONT.bracket - 2 * TRAILER_FRONT.inset - TRAILER_FRONT.gap) / 2;
    lamp({
      id: `end-outline-front-${sideName(side)}`,
      fns: ['end-outline-front'],
      side,
      part: 'trailer',
      facing: 'front',
      box: boxOf(x, lateral(side, outline - width, outline), frontZ),
      hue: HUE.plateWhite,
      seat,
    });
    const position = outline - width - TRAILER_FRONT.gap;
    lamp({
      id: `front-position-${sideName(side)}`,
      fns: ['front-position'],
      side,
      part: 'trailer',
      facing: 'front',
      box: boxOf(x, lateral(side, position - width, position), frontZ),
      hue: HUE.plateWhite,
      seat,
    });
  }

  // side markers, one on each drawbar arm, and on a lafette a block at each rear corner
  const run = trailerSideRun(spec, variant);
  if (lafette) {
    const outer = hw - LAFETTE.guardY[1];
    sideMarkers(
      sink,
      'side-marker',
      run,
      hw,
      markerFns,
      'trailer',
      true,
      LAFETTE.markRelief[1],
      outer,
    );
    for (const side of SIDES) {
      const x0 = a.rearX + LAFETTE.lampBar.depth;
      sink.brackets.push({
        part: 'trailer',
        box: boxOf([x0, x0 + REAR_CORNER.length], lateral(side, hw - REAR_CORNER.width, hw), [
          deck,
          deck + REAR_CORNER.height,
        ]),
        shell: true,
      });
      const pad = (REAR_CORNER.length - MARKER_LENGTH) / 2;
      const zPad = (REAR_CORNER.height - MARKER_HEIGHT) / 2;
      lamp({
        id: `side-marker-rear-${sideName(side)}`,
        fns: markerFns,
        side,
        part: 'trailer',
        facing: side > 0 ? 'left' : 'right',
        box: boxOf(
          [x0 + pad, x0 + pad + MARKER_LENGTH],
          lateral(side, hw, hw + LAFETTE.markRelief[1]),
          [deck + zPad, deck + zPad + MARKER_HEIGHT],
        ),
        hue: HUE.sideMarker,
        shell: true,
      });
    }
  } else {
    sideMarkers(sink, 'side-marker', run, hw, markerFns, 'trailer', false);
  }
  const xc = f.kink - DOLLY_MARKER.behindKink;
  const armY = DRAWBAR_SPREAD * (1 - xc / a.eye.x) + ARM_WIDTH / 2;
  for (const side of SIDES) {
    const outer = armY + DOLLY_MARKER.bracket;
    const halfBracket = MARKER_LENGTH / 2 + 0.02;
    const halfZ = MARKER_HEIGHT / 2;
    sink.brackets.push({
      part: 'dolly',
      box: boxOf([xc - halfBracket, xc + halfBracket], lateral(side, armY, outer), [
        f.plateMid - halfZ - 0.01,
        f.plateMid + halfZ + 0.01,
      ]),
      shell: false,
    });
    lamp({
      id: `side-marker-dolly-${sideName(side)}`,
      fns: markerFns,
      side,
      part: 'dolly',
      facing: side > 0 ? 'left' : 'right',
      box: boxOf(
        [xc - MARKER_LENGTH / 2, xc + MARKER_LENGTH / 2],
        lateral(side, outer, outer + DOLLY_MARKER.relief),
        [f.plateMid - halfZ, f.plateMid + halfZ],
      ),
      hue: HUE.sideMarker,
      seat: 'detail',
    });
  }

  // rear: the clusters, end-outline markers at the top and the plate lamp
  const { tailLamp, underrunGuard } = spec;
  const base = lowDeck === null ? deck : lowDeck.rearDeck;
  const tailZ: Range = [
    base + metres(tailLamp.sill),
    base + metres(tailLamp.sill) + metres(tailLamp.height),
  ];
  const outer = hw - metres(tailLamp.inset);
  const guardTop = metres(underrunGuard.lowerEdge) + metres(underrunGuard.height);
  // clusters below the deck hang on a bracket from the underrun guard's top to the underside
  const hung = tailZ[1] <= underside;
  if (hung) {
    if (tailZ[0] < guardTop)
      throw new Error(`trailerLamps: ${spec.id}'s tail lamps reach the underrun guard`);
    for (const side of SIDES) {
      sink.brackets.push({
        part: 'trailer',
        box: boxOf(
          [a.rearX, a.rearX + metres(underrunGuard.depth)],
          lateral(
            side,
            metres(underrunGuard.strutOffset) + metres(underrunGuard.strutWidth),
            outer + 0.03,
          ),
          [guardTop, underside],
        ),
        shell: false,
      });
    }
  }
  const rearX: Range = [a.rearX - LENS_DEPTH, a.rearX];
  addChambers(
    sink,
    'tail',
    TAIL_CHAMBERS,
    outer,
    metres(tailLamp.width),
    {
      part: 'trailer',
      facing: 'rear',
      hue: HUE.tailLamp,
      shell: false,
      seat: hung ? 'detail' : 'part',
    },
    rearX,
    tailZ,
  );
  const outlineAt = (): { y: (side: number) => Range; z: Range } => {
    const near = (top: number, edge: number, width: number = SMALL_LAMP.width) => ({
      y: (side: number) => lateral(side, edge - width, edge),
      z: [top - SMALL_LAMP.height - 0.02, top - 0.02] as Range,
    });
    if (lafette) return near(deck + LAFETTE.lampBar.height, hw - 0.02);
    if (lowDeck !== null) return near(lowDeck.carrierTop + 0.01, hw - 0.005, STRIP - 0.01);
    if (isBox) return near(deck + SWAP_BODY_HEIGHT, hw - 0.005, STRIP - 0.01);
    return near(deck + RAMP_HEIGHT, RAMP_GAP + RAMP_WIDTH - 0.01);
  };
  const outline = outlineAt();
  for (const side of SIDES) {
    lamp({
      id: `end-outline-rear-${sideName(side)}`,
      fns: ['end-outline-rear'],
      side,
      part: 'trailer',
      facing: 'rear',
      box: boxOf(rearX, outline.y(side), outline.z),
      hue: HUE.tailLamp,
    });
  }
  lamp({
    id: 'rear-plate',
    fns: ['rear-plate'],
    side: 0,
    part: 'trailer',
    facing: 'rear',
    box: boxOf(
      rearX,
      [-PLATE_LAMP.halfWidth, PLATE_LAMP.halfWidth],
      [
        guardTop - PLATE_LAMP.belowGuardTop - PLATE_LAMP.height,
        guardTop - PLATE_LAMP.belowGuardTop,
      ],
    ),
    hue: HUE.plateWhite,
    seat: 'detail',
  });
  return sink;
}

/** A lens as the shell scripts draw it or check its face. */
const lensParams = (l: Lamp) => ({ id: l.id, box: l.box, facing: l.facing, hue: hex(l.hue) });

/** Lens objects and face checks for `tools/blender/cab_shell.py`. */
export function cabLampParams(spec: TruckSpec, cabLength: number) {
  const { lamps } = truckLamps(spec, cabLength);
  return { lenses: lamps.filter((l) => l.part === 'cab').map(lensParams) };
}

/** The detail lamps `tools/blender/body_shell.py` must give a face. */
export function bodyLampParams(spec: TruckSpec, cabLength: number) {
  const { lamps } = truckLamps(spec, cabLength);
  return {
    mounts: lamps.filter((l) => l.part === 'body' && l.seat === 'part').map(lensParams),
  };
}

/** The shell's own lenses and brackets, and the detail lamps it must give a face, for `trailer_shell.py`. */
export function trailerLampParams(spec: TrailerSpec) {
  const { lamps, brackets } = trailerLamps(spec, 'shell');
  const own = lamps.filter((l) => l.part === 'trailer');
  return {
    lenses: own.filter((l) => l.shell).map(lensParams),
    brackets: brackets.filter((b) => b.part === 'trailer' && b.shell).map((b) => b.box),
    mounts: own.filter((l) => !l.shell && l.seat === 'part').map(lensParams),
  };
}
