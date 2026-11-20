import type {
  Fixture,
  Marking,
  Obstacle,
  ObstacleKind,
  Prop,
  PropAsset,
  Rect2,
  StreetSpec,
  Surface,
} from '../contracts/layout';
import type { Obb } from '../contracts/sim';
import { arrow, solidLine } from './markings';

const KERB_WIDTH = 0.15;
const KERB_HEIGHT = 0.15;
const CENTRE_LINE_WIDTH = 0.12;
const STOP_LINE_WIDTH = 0.5;
const STOP_LINE_SETBACK = 0.5; // from the pavement, on the yard side
const EXIT_ARROW_LENGTH = 5;
const EXIT_ARROW_OFFSET = 3; // tail distance behind the stop line

export const BOUNDS: Rect2 = { minX: -40, minY: -40, maxX: 140, maxY: 100 };
export const YARD: Rect2 = { minX: 0, minY: 0, maxX: 100, maxY: 70 };
export const STREET: StreetSpec = {
  kerbY: -2.5,
  width: 7,
  pavement: 2.5,
  fromX: BOUNDS.minX,
  toX: BOUNDS.maxX,
  entrance: { fromX: 42, toX: 58 },
};

function rectObb(rect: Rect2): Obb {
  return {
    cx: (rect.minX + rect.maxX) / 2,
    cy: (rect.minY + rect.maxY) / 2,
    halfLength: (rect.maxX - rect.minX) / 2,
    halfWidth: (rect.maxY - rect.minY) / 2,
    heading: 0,
  };
}

/** Collects obstacles and numbers their ids per kind: `<prefix><kind>-<n>`. */
export class ObstacleBuilder {
  private readonly counts = new Map<ObstacleKind, number>();
  private readonly items: Obstacle[] = [];
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  get obstacles(): readonly Obstacle[] {
    return this.items;
  }

  add(kind: ObstacleKind, obb: Obb, height: number): void {
    const n = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, n);
    this.items.push({ id: `${this.prefix}${kind}-${n}`, kind, obb, height });
  }

  addRect(kind: ObstacleKind, rect: Rect2, height: number): void {
    this.add(kind, rectObb(rect), height);
  }

  /** Box of `length` along `heading` and `width` across it. */
  addBox(
    kind: ObstacleKind,
    cx: number,
    cy: number,
    length: number,
    width: number,
    heading: number,
    height: number,
  ): void {
    this.add(kind, { cx, cy, halfLength: length / 2, halfWidth: width / 2, heading }, height);
  }

  /** Thin box along the segment a-b, centred on it. */
  addSegment(
    kind: ObstacleKind,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    width: number,
    height: number,
  ): void {
    this.addBox(
      kind,
      (ax + bx) / 2,
      (ay + by) / 2,
      Math.hypot(bx - ax, by - ay),
      width,
      Math.atan2(by - ay, bx - ax),
      height,
    );
  }
}

/** Collects props, numbering ids per asset: `<asset>-<n>`. Colliders are built in world coordinates. */
export class PropBuilder {
  private readonly counts = new Map<PropAsset, number>();
  private readonly items: Prop[] = [];

  get props(): readonly Prop[] {
    return this.items;
  }

  add(asset: PropAsset, fill: (b: ObstacleBuilder) => void, fixture?: Fixture): void {
    const n = (this.counts.get(asset) ?? 0) + 1;
    this.counts.set(asset, n);
    const b = new ObstacleBuilder('');
    fill(b);
    const colliders = b.obstacles.map(({ kind, obb, height }) => ({ kind, obb, height }));
    this.items.push({
      id: `${asset}-${n}`,
      asset,
      colliders,
      ...(fixture === undefined ? {} : { fixture }),
    });
  }
}

/** Boundary boxes just inside the yard edge, open at the street entrance. */
export function addYardEdge(
  b: ObstacleBuilder,
  kind: ObstacleKind,
  thickness: number,
  height: number,
  entrance: StreetSpec['entrance'],
): void {
  const { minX, minY, maxX, maxY } = YARD;
  const t = thickness;
  b.addRect(kind, { minX, minY, maxX: minX + t, maxY }, height);
  b.addRect(kind, { minX: maxX - t, minY, maxX, maxY }, height);
  b.addRect(kind, { minX: minX + t, minY: maxY - t, maxX: maxX - t, maxY }, height);
  b.addRect(kind, { minX: minX + t, minY, maxX: entrance.fromX, maxY: minY + t }, height);
  b.addRect(kind, { minX: entrance.toX, minY, maxX: maxX - t, maxY: minY + t }, height);
}

const LAMP_SIZE = 0.3;
const MAST_HEIGHT = 10; // floodlight mast in the yard corners
const STREET_LAMP_HEIGHT = 8;
const LAMP_INSET = 1.5;
const LAMP_SPACING = 25;

/** Lamp posts in the yard corners and along the far pavement, all aimed at the yard centre. */
export function addLamps(p: PropBuilder, street: StreetSpec): void {
  const { minX, minY, maxX, maxY } = YARD;
  const aim = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const lamp = (x: number, y: number, height: number, kind: Fixture['kind']): void =>
    p.add('lamp', (b) => b.addBox('lamp', x, y, LAMP_SIZE, LAMP_SIZE, 0, height), { kind, aim });
  for (const x of [minX + LAMP_INSET, maxX - LAMP_INSET]) {
    for (const y of [minY + LAMP_INSET, maxY - LAMP_INSET]) lamp(x, y, MAST_HEIGHT, 'flood');
  }
  const y = street.kerbY - street.width - street.pavement / 2;
  for (let x = street.fromX + 15; x <= street.toX - 15; x += LAMP_SPACING) {
    lamp(x, y, STREET_LAMP_HEIGHT, 'street');
  }
}

const BOLLARD_SIZE = 0.25;
const BOLLARD_HEIGHT = 1.2;
const GATEHOUSE = { gap: 3, length: 4, width: 3.2, height: 3, y: 3 }; // gap from the entrance edge
const BARRIER = { inset: 0.5, y: 2, length: 0.4, width: 0.6, height: 1 };
const GATEHOUSE_BOLLARD_Y = [1.3, 4.7];

export function addBollard(b: ObstacleBuilder, x: number, y: number): void {
  b.addBox('bollard', x, y, BOLLARD_SIZE, BOLLARD_SIZE, 0, BOLLARD_HEIGHT);
}

export function addBollardProp(p: PropBuilder, x: number, y: number): void {
  p.add('bollard', (b) => addBollard(b, x, y));
}

/** Gatehouse and barrier post beside the entrance, with bollards guarding the gatehouse. */
export function addGate(p: PropBuilder, { entrance }: StreetSpec): void {
  const { gap, length, width, height, y } = GATEHOUSE;
  const x = entrance.toX + gap + length / 2;
  p.add('gate', (b) => {
    b.addBox('gatehouse', x, y, length, width, 0, height);
    for (const by of GATEHOUSE_BOLLARD_Y) addBollard(b, x - length / 2 - 1, by);
    // heading pi: the boom of the raised barrier points into the entrance
    b.addBox(
      'barrier',
      entrance.toX + BARRIER.inset,
      BARRIER.y,
      BARRIER.length,
      BARRIER.width,
      Math.PI,
      BARRIER.height,
    );
  });
}

/** Stop line across the yard exit with an arrow pointing out. A kerbed street carries no edge lines. */
function exitMarkings({ kerbY, pavement, entrance }: StreetSpec): Marking[] {
  const stopY = kerbY + pavement + STOP_LINE_SETBACK;
  return [
    solidLine('stop', entrance.fromX, stopY, entrance.toX, stopY, STOP_LINE_WIDTH),
    ...arrow(
      (entrance.fromX + entrance.toX) / 2,
      stopY + STOP_LINE_WIDTH / 2 + EXIT_ARROW_OFFSET + EXIT_ARROW_LENGTH,
      -Math.PI / 2,
      EXIT_ARROW_LENGTH,
    ),
  ];
}

export function streetFeatures(street: StreetSpec): {
  surfaces: Surface[];
  obstacles: Obstacle[];
  markings: Marking[];
} {
  const { kerbY, width, pavement, fromX, toX, entrance } = street;
  const farY = kerbY - width;
  const surfaces: Surface[] = [
    { kind: 'street', rect: { minX: fromX, minY: farY, maxX: toX, maxY: kerbY } },
    { kind: 'pavement', rect: { minX: fromX, minY: kerbY, maxX: toX, maxY: kerbY + pavement } },
    { kind: 'pavement', rect: { minX: fromX, minY: farY - pavement, maxX: toX, maxY: farY } },
  ];

  const kerbs = new ObstacleBuilder('street-');
  const yardSide = { minY: kerbY, maxY: kerbY + KERB_WIDTH };
  kerbs.addRect('kerb', { minX: fromX, maxX: entrance.fromX, ...yardSide }, KERB_HEIGHT);
  kerbs.addRect('kerb', { minX: entrance.toX, maxX: toX, ...yardSide }, KERB_HEIGHT);
  kerbs.addRect(
    'kerb',
    { minX: fromX, minY: farY - KERB_WIDTH, maxX: toX, maxY: farY },
    KERB_HEIGHT,
  );

  const line = (kind: Marking['kind'], y: number, lineWidth: number, dashed: boolean): Marking => ({
    kind,
    from: { x: fromX, y },
    to: { x: toX, y },
    width: lineWidth,
    dashed,
  });
  const markings: Marking[] = [
    line('lane-centre', kerbY - width / 2, CENTRE_LINE_WIDTH, true),
    ...exitMarkings(street),
  ];

  return { surfaces, obstacles: [...kerbs.obstacles], markings };
}
