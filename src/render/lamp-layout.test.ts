import { describe, expect, it } from 'vitest';
import { TRAILER_IDS, TRUCK_IDS, type TrailerSpec } from '../contracts/vehicle';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { BODY_SHELL, FLOOR_TOP, TIPPER_SHELL } from './body-dims';
import { CAB_LENGTH, FRAME_TOP } from './cab-dims';
import {
  type Lamp,
  LAMP_COLOURS,
  type LampFn,
  type LampLayout,
  trailerLamps,
  truckLamps,
} from './lamp-layout';
import { TRAILER_LOOKS, TRUCK_LOOKS } from './livery';
import { REALISM_HUES as HUE } from './realism-hues';
import { LAFETTE, lowLoaderDeck, RAMP_HEIGHT, SWAP_BODY_HEIGHT } from './trailer-dims';

/*
 * UN R48 (06 series, Supplement 10), https://eur-lex.europa.eu/eli/reg/2019/57/oj/eng, for an N3
 * truck and an O4 drawbar trailer. Heights are measured to the lowest and highest point (5.8);
 * a trailer's lengths include the drawbar (2.15.2).
 */

type Vehicle = {
  readonly name: string;
  readonly trailer: boolean;
  readonly halfWidth: number;
  readonly front: number;
  readonly rear: number;
  readonly windscreenTop?: number;
  /** The top of the body at its rear corners, above the ground (6.13.4.2). */
  readonly rearTop: number;
  /** In one frame, the combination straight. */
  readonly lamps: readonly Lamp[];
};

const EPS = 1e-9;

function truckVehicle(id: (typeof TRUCK_IDS)[number], cabLength: number): Vehicle {
  const spec = truckById(id);
  const a = truckAnchors(spec);
  const { cab } = spec;
  return {
    name: `${id} with a ${cabLength} m cab`,
    trailer: false,
    halfWidth: spec.width.value / 2000,
    front: a.frontX,
    rear: a.rearX,
    windscreenTop: FRAME_TOP + (cab.glassSill.value + cab.glassHeight.value) / 1000,
    // the tipper's corner posts, above its drop sides; the tarpaulin's top
    rearTop:
      TRUCK_LOOKS[id].body.kind === 'tipper'
        ? FLOOR_TOP + TIPPER_SHELL.wallHeight + BODY_SHELL.rim
        : BODY_SHELL.tarpTop,
    lamps: truckLamps(spec, cabLength).lamps,
  };
}

/** A trailer body's rear top: the swap body, a lafette's lamp bar, a low-loader's carrier or ramps. */
function trailerRearTop(spec: TrailerSpec, variant: 'procedural' | 'shell'): number {
  const deck = spec.deckHeight.value / 1000;
  const kind = TRAILER_LOOKS[spec.id].kind;
  if (variant === 'shell' && kind === 'lafette') return deck + LAFETTE.lampBar.height;
  if (variant === 'shell' && kind === 'low-loader') return lowLoaderDeck(spec).carrierTop + 0.01;
  return deck + (spec.body === 'box' ? SWAP_BODY_HEIGHT : RAMP_HEIGHT);
}

function trailerVehicle(
  id: (typeof TRAILER_IDS)[number],
  variant: 'procedural' | 'shell',
): Vehicle {
  const spec = trailerById(id);
  const a = trailerAnchors(spec);
  const shift = (l: Lamp): Lamp =>
    l.part !== 'dolly'
      ? l
      : {
          ...l,
          box: [[l.box[0][0] + a.turntable.x, l.box[0][1] + a.turntable.x], l.box[1], l.box[2]],
        };
  return {
    name: `${id} (${variant})`,
    trailer: true,
    halfWidth: spec.width.value / 2000,
    front: a.turntable.x + a.eye.x,
    rear: a.rearX,
    rearTop: trailerRearTop(spec, variant),
    lamps: trailerLamps(spec, variant).lamps.map(shift),
  };
}

const vehicles: readonly Vehicle[] = [
  ...TRUCK_IDS.flatMap((id) => [
    truckVehicle(id, CAB_LENGTH),
    truckVehicle(id, TRUCK_LOOKS[id].cab.length),
  ]),
  ...TRAILER_IDS.flatMap((id) => [trailerVehicle(id, 'procedural'), trailerVehicle(id, 'shell')]),
];

const withFn = (v: Vehicle, fn: LampFn): Lamp[] => v.lamps.filter((l) => l.fns.includes(fn));
const low = (l: Lamp): number => l.box[2][0];
const high = (l: Lamp): number => l.box[2][1];
/** Distance from the vehicle's outer edge to the lamp's outermost point. */
const fromEdge = (v: Vehicle, l: Lamp): number =>
  l.side > 0 ? v.halfWidth - l.box[1][1] : l.box[1][0] + v.halfWidth;
/** The category 5 or 6 side indicators: a side marker that flashes carries the function too. */
const repeaters = (v: Vehicle): Lamp[] =>
  withFn(v, 'side-indicator').filter((l) => !l.fns.includes('side-marker'));
/** The white half of the stalk lamps at the rear corners: visible from the front, though at the rear. */
const isRearView = (l: Lamp): boolean => l.id.startsWith('end-outline-view-');
const pair = (v: Vehicle, fn: LampFn): { left: Lamp; right: Lamp } => {
  const lamps = (fn === 'side-indicator' ? repeaters(v) : withFn(v, fn)).filter(
    (l) => !isRearView(l),
  );
  const left = lamps.filter((l) => l.side > 0);
  const right = lamps.filter((l) => l.side < 0);
  expect(left, `${v.name} ${fn} left`).toHaveLength(1);
  expect(right, `${v.name} ${fn} right`).toHaveLength(1);
  return { left: left[0] as Lamp, right: right[0] as Lamp };
};
const innerGap = ({ left, right }: { left: Lamp; right: Lamp }): number =>
  left.box[1][0] - right.box[1][1];

type PairRule = {
  readonly fn: LampFn;
  readonly paragraph: string;
  readonly height: readonly [number, number];
  /** Outermost point from the outer edge, at most. */
  readonly outer?: number;
  readonly trailerOuter?: number;
  readonly innerApart?: number;
  readonly truckOnly?: boolean;
  readonly trailerOnly?: boolean;
};

const PAIRS: readonly PairRule[] = [
  {
    fn: 'dipped-beam',
    paragraph: '6.2.4',
    height: [0.5, 1.2],
    outer: 0.4,
    innerApart: 0.6,
    truckOnly: true,
  },
  {
    fn: 'front-position',
    paragraph: '6.9.4',
    height: [0.25, 1.5],
    outer: 0.4,
    trailerOuter: 0.15,
    innerApart: 0.6,
  },
  {
    fn: 'front-indicator',
    paragraph: '6.5.4',
    height: [0.35, 1.5],
    outer: 0.4,
    innerApart: 0.6,
    truckOnly: true,
  },
  { fn: 'rear-indicator', paragraph: '6.5.4', height: [0.35, 1.5], outer: 0.4, innerApart: 0.6 },
  { fn: 'rear-position', paragraph: '6.10.4', height: [0.35, 1.5], outer: 0.4, innerApart: 0.6 },
  { fn: 'stop', paragraph: '6.7.4', height: [0.35, 1.5], innerApart: 0.6 },
  // two mandatory above 6 m (6.4.2.2)
  { fn: 'reversing', paragraph: '6.4.4', height: [0.25, 1.2] },
  // grouped with the rear cluster, so 1,200 mm (6.11.4.2); two lamps need no side rule (6.11.4.1)
  { fn: 'rear-fog', paragraph: '6.11.4', height: [0.25, 1.2] },
  { fn: 'end-outline-front', paragraph: '6.13.4', height: [0, Infinity], outer: 0.4 },
  { fn: 'end-outline-rear', paragraph: '6.13.4', height: [0, Infinity], outer: 0.4 },
  { fn: 'side-indicator', paragraph: '6.5.4.2.1', height: [0.5, 1.5], truckOnly: true },
];

describe.each(vehicles)('R48 lamps of $name', (v) => {
  it('give every lens one colour (5.15) and a unique id', () => {
    for (const l of v.lamps) {
      expect(new Set(l.fns.map((fn) => LAMP_COLOURS[fn])).size, l.id).toBe(1);
    }
    expect(new Set(v.lamps.map((l) => l.id)).size).toBe(v.lamps.length);
  });

  it('keep lenses apart from each other', () => {
    const overlap = (a: Lamp, b: Lamp): boolean =>
      a.part === b.part &&
      a.box.every(([a0, a1], i) => {
        const [b0, b1] = b.box[i] ?? [0, 0];
        return a0 < b1 - EPS && b0 < a1 - EPS;
      });
    for (const [i, a] of v.lamps.entries()) {
      for (const b of v.lamps.slice(i + 1)) expect(overlap(a, b), `${a.id} / ${b.id}`).toBe(false);
    }
  });

  it.each(PAIRS)('place the $fn pair ($paragraph)', (rule) => {
    if ((rule.truckOnly && v.trailer) || (rule.trailerOnly && !v.trailer)) {
      // an O4 has no category 5 or 6 pair (6.5.3 B); its flashing side markers are checked below
      expect(rule.fn === 'side-indicator' ? repeaters(v) : withFn(v, rule.fn)).toHaveLength(0);
      return;
    }
    const lamps = pair(v, rule.fn);
    for (const l of [lamps.left, lamps.right]) {
      expect(low(l), `${l.id} low`).toBeGreaterThanOrEqual(rule.height[0] - EPS);
      expect(high(l), `${l.id} high`).toBeLessThanOrEqual(rule.height[1] + EPS);
      const outer = v.trailer ? (rule.trailerOuter ?? rule.outer) : rule.outer;
      if (outer !== undefined)
        expect(fromEdge(v, l), `${l.id} outer`).toBeLessThanOrEqual(outer + EPS);
    }
    if (rule.innerApart !== undefined) {
      expect(innerGap(lamps)).toBeGreaterThanOrEqual(rule.innerApart - EPS);
    }
  });

  it('keep each rear fog lamp more than 100 mm from each stop lamp (6.11.9)', () => {
    for (const fog of withFn(v, 'rear-fog')) {
      for (const stop of withFn(v, 'stop')) {
        const gap = Math.max(
          stop.box[1][0] - fog.box[1][1],
          fog.box[1][0] - stop.box[1][1],
          stop.box[2][0] - fog.box[2][1],
          fog.box[2][0] - stop.box[2][1],
        );
        expect(gap, `${fog.id} / ${stop.id}`).toBeGreaterThan(0.1);
      }
    }
  });

  it('put the end-outline markers at the top of their end (6.13.4.2)', () => {
    const top = (fn: LampFn): number => Math.max(...withFn(v, fn).map(high));
    const front = v.lamps.filter(
      (l) => l.facing === 'front' && !l.fns.includes('end-outline-front'),
    );
    const rear = v.lamps.filter((l) => l.facing === 'rear' && !l.fns.includes('end-outline-rear'));
    if (v.windscreenTop === undefined) {
      expect(top('end-outline-front')).toBeGreaterThanOrEqual(Math.max(...front.map(high)) - EPS);
    } else {
      expect(top('end-outline-front')).toBeGreaterThanOrEqual(v.windscreenTop - EPS);
    }
    expect(top('end-outline-rear')).toBeGreaterThanOrEqual(Math.max(...rear.map(high)) - EPS);
  });

  it('fit the cat 6 side indicators within 1,800 mm of the front (6.5.4.3)', () => {
    for (const l of repeaters(v)) {
      expect(v.front - l.box[0][0], l.id).toBeLessThanOrEqual(1.8 + EPS);
    }
  });

  it.each([1, -1])('space the side markers along side %i (6.18.4)', (side) => {
    const markers = withFn(v, 'side-marker')
      .filter((l) => l.side === side)
      .sort((a, b) => a.box[0][0] - b.box[0][0]);
    expect(markers.length).toBeGreaterThanOrEqual(2);
    const centre = (l: Lamp): number => (l.box[0][0] + l.box[0][1]) / 2;
    for (const l of markers) {
      expect(low(l), l.id).toBeGreaterThanOrEqual(0.25 - EPS);
      expect(high(l), l.id).toBeLessThanOrEqual(1.5 + EPS);
    }
    const [rearmost] = markers;
    const foremost = markers[markers.length - 1];
    if (rearmost === undefined || foremost === undefined) throw new Error('no markers');
    expect(v.front - foremost.box[0][0], 'foremost').toBeLessThanOrEqual(3 + EPS);
    // a trailer's length runs to the drawbar eye (2.15.2), so the dolly's markers keep that reach
    if (v.trailer) expect(foremost.part, 'foremost').toBe('dolly');
    expect(rearmost.box[0][1] - v.rear, 'rearmost').toBeLessThanOrEqual(1 + EPS);
    markers.slice(1).forEach((l, i) => {
      const prev = markers[i] as Lamp;
      expect(centre(l) - centre(prev), `${prev.id} → ${l.id}`).toBeLessThanOrEqual(3 + EPS);
    });
    const third = (v.front - v.rear) / 3;
    expect(markers.some((l) => centre(l) >= v.rear + third && centre(l) <= v.front - third)).toBe(
      true,
    );
  });

  // 6.18.7 lets amber side markers flash with the same-side indicators. 6.5.3.1(c) needs it of an
  // O4's trailer, which has no category 5 lamps, and (b) of an N3 over 9 m; 6.18.9 wants them amber.
  it('flash every amber side marker with the indicators, at least three per side (6.18.7, 6.5.3.1)', () => {
    for (const l of withFn(v, 'side-marker')) {
      expect(l.fns, l.id).toContain('side-indicator');
      expect(l.hue, l.id).toBe(HUE.sideMarker);
    }
    for (const side of [1, -1]) {
      const flashing = v.lamps.filter(
        (l) => l.side === side && l.fns.includes('side-marker') && l.fns.includes('side-indicator'),
      );
      expect(flashing.length).toBeGreaterThanOrEqual(3);
    }
  });

  // 6.13.2(a): two more white lamps visible from the front, as close to the rear as practicable
  // (6.13.4.3), beside the red end-outline lamps; 6.13.9 asks that the main mirrors show them.
  it('fit a white stalk lens facing forward at each rear top corner (6.13.2(a), 6.13.4)', () => {
    const lamps = v.lamps.filter(isRearView);
    expect(lamps.map((l) => l.side).sort()).toEqual([-1, 1]);
    const reds = withFn(v, 'end-outline-rear');
    for (const l of lamps) {
      expect(l.fns, l.id).toEqual(['end-outline-front']);
      expect(l.facing, l.id).toBe('front');
      expect(l.shell, l.id).toBe(false);
      expect(l.seat, l.id).toBe('detail');
      expect(l.box[0][0] - v.rear, `${l.id} from the rear`).toBeLessThanOrEqual(0.4);
      expect(fromEdge(v, l), `${l.id} outer`).toBeLessThanOrEqual(0.4 + EPS);
      const red = reds.find((r) => r.side === l.side);
      expect(red, l.id).toBeDefined();
      // at the top of the body (6.13.4.2), and outboard of the red lamp
      expect(high(l), l.id).toBeGreaterThanOrEqual(v.rearTop - 0.03);
      expect(high(l), l.id).toBeLessThanOrEqual(v.rearTop + EPS);
      expect(Math.abs(l.box[1][l.side > 0 ? 1 : 0]), l.id).toBeGreaterThan(
        Math.abs((red as Lamp).box[1][l.side > 0 ? 1 : 0]),
      );
    }
  });

  it('pair every lamp with its mirror image across the centreline', () => {
    const mirrored = (l: Lamp): string =>
      JSON.stringify([l.fns, l.part, l.box[0], [-l.box[1][1], -l.box[1][0]], l.box[2]]);
    const key = (l: Lamp): string => JSON.stringify([l.fns, l.part, l.box[0], l.box[1], l.box[2]]);
    const lamps = new Set(v.lamps.map(key));
    for (const l of v.lamps.filter((l) => l.side !== 0)) {
      expect(lamps.has(mirrored(l)), l.id).toBe(true);
    }
  });

  it('give a trailer, and only a trailer, a rear plate lamp (6.8)', () => {
    const plate = withFn(v, 'rear-plate');
    expect(plate).toHaveLength(v.trailer ? 1 : 0);
  });
});

describe('lamp layout parts', () => {
  const layouts: readonly [string, LampLayout][] = [
    ...TRUCK_IDS.map((id): [string, LampLayout] => [
      id,
      truckLamps(truckById(id), TRUCK_LOOKS[id].cab.length),
    ]),
    ...TRAILER_IDS.map((id): [string, LampLayout] => [id, trailerLamps(trailerById(id), 'shell')]),
  ];

  it.each(layouts)('give every lens of %s a positive size', (_id, { lamps }) => {
    for (const l of lamps) for (const [a, b] of l.box) expect(b - a, l.id).toBeGreaterThan(0);
  });

  it('keep the lafette shell markers in the shell and everything else in the detail', () => {
    const { lamps } = trailerLamps(trailerById('krone-azw-18'), 'shell');
    expect(lamps.filter((l) => l.shell).every((l) => l.fns.includes('side-marker'))).toBe(true);
    expect(trailerLamps(trailerById('krone-azw-18'), 'procedural').lamps.some((l) => l.shell)).toBe(
      false,
    );
  });
});
