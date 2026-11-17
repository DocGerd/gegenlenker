import type { Layout } from '../../contracts/layout';
import { solidLine } from '../markings';
import {
  addBollard,
  addGate,
  addLamps,
  addYardEdge,
  BOUNDS,
  ObstacleBuilder,
  STREET,
  YARD,
} from '../street';

const FENCE_THICKNESS = 0.1;
const FENCE_HEIGHT = 2;
const HALL = { minX: 60, minY: 42, maxX: 96, maxY: 64 };
const HALL_HEIGHT = 8;
const HALL_WALL = 0.4;
const GATE_WIDTH = 4.5;
const GATE_CENTRES = [70, 86];
const GATE_BOLLARD_OFFSET = GATE_WIDTH / 2 + 0.7; // outside each jamb
const PARKED = { x: 1.75, width: 2.5, length: 10, height: 3.5, firstY: 36 };
const PARKED_BAYS = 3;
const PARKING_LINE_WIDTH = 0.12;

function build(): Layout['obstacles'] {
  const b = new ObstacleBuilder('');
  addYardEdge(b, 'fence', FENCE_THICKNESS, FENCE_HEIGHT, STREET.entrance);

  const { minX, minY, maxX, maxY } = HALL;
  const wall = (rect: { minX: number; minY: number; maxX: number; maxY: number }): void =>
    b.addRect('hall', rect, HALL_HEIGHT);
  wall({ minX, minY, maxX: minX + HALL_WALL, maxY });
  wall({ minX: maxX - HALL_WALL, minY, maxX, maxY });
  wall({ minX: minX + HALL_WALL, minY: maxY - HALL_WALL, maxX: maxX - HALL_WALL, maxY });
  let from = minX + HALL_WALL;
  for (const c of GATE_CENTRES) {
    wall({ minX: from, minY, maxX: c - GATE_WIDTH / 2, maxY: minY + HALL_WALL });
    from = c + GATE_WIDTH / 2;
  }
  wall({ minX: from, minY, maxX: maxX - HALL_WALL, maxY: minY + HALL_WALL });

  for (let i = 0; i < PARKED_BAYS; i++) {
    const cy = PARKED.firstY + PARKED.length * (i + 0.5);
    b.addBox('parked', PARKED.x, cy, PARKED.width, PARKED.length, 0, PARKED.height);
  }

  addLamps(b, STREET);
  addGate(b, STREET);
  for (const c of GATE_CENTRES) {
    for (const side of [-1, 1]) addBollard(b, c + side * GATE_BOLLARD_OFFSET, minY - 0.8);
  }
  return b.obstacles;
}

/** Bay ends and the open side line of the parked-trailer row. */
function parkingLines(): Layout['markings'] {
  const sideX = PARKED.x + PARKED.width / 2 + PARKING_LINE_WIDTH;
  const endY = (i: number): number => PARKED.firstY + PARKED.length * i;
  return [
    ...Array.from({ length: PARKED_BAYS + 1 }, (_, i) =>
      solidLine('bay', FENCE_THICKNESS, endY(i), sideX, endY(i), PARKING_LINE_WIDTH),
    ),
    solidLine('bay', sideX, endY(0), sideX, endY(PARKED_BAYS), PARKING_LINE_WIDTH),
  ];
}

export const depot: Layout = {
  id: 'depot',
  bounds: BOUNDS,
  yard: YARD,
  street: STREET,
  start: { x: 30, y: 15, heading: 0 },
  obstacles: build(),
  markings: parkingLines(),
};
