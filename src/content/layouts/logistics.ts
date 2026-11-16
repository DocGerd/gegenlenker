import type { Layout, Marking } from '../../contracts/layout';
import { addLamps, addYardEdge, BOUNDS, ObstacleBuilder, STREET, YARD } from '../street';

const WALL_THICKNESS = 0.3;
const WALL_HEIGHT = 2.5;
const HALL = { minX: 10, minY: 52, maxX: 74, maxY: 68 };
const HALL_HEIGHT = 8;
export const RAMP = { minX: 14, minY: 49, maxX: 70, maxY: 52 };
const RAMP_HEIGHT = 1.2;
export const BAY_SPACING = 4;
const BAY_LINE_LENGTH = 18;
const BAY_LINE_WIDTH = 0.12;
const TRAILER = { width: 2.5, length: 13.6, height: 4 };
const TRAILER_X = [82, 86.5, 91, 95.5];
const TRAILER_Y = 45;

function build(): Layout['obstacles'] {
  const b = new ObstacleBuilder('');
  addYardEdge(b, 'wall', WALL_THICKNESS, WALL_HEIGHT, STREET.entrance);
  b.addRect('hall', HALL, HALL_HEIGHT);
  b.addRect('ramp', RAMP, RAMP_HEIGHT);
  for (const x of TRAILER_X) {
    b.addBox('parked', x, TRAILER_Y, TRAILER.width, TRAILER.length, 0, TRAILER.height);
  }
  addLamps(b, STREET);
  return b.obstacles;
}

function bayLines(): Marking[] {
  const lines: Marking[] = [];
  for (let x = RAMP.minX; x <= RAMP.maxX; x += BAY_SPACING) {
    lines.push({
      kind: 'bay',
      from: { x, y: RAMP.minY },
      to: { x, y: RAMP.minY - BAY_LINE_LENGTH },
      width: BAY_LINE_WIDTH,
      dashed: false,
    });
  }
  return lines;
}

export const logistics: Layout = {
  id: 'logistics',
  bounds: BOUNDS,
  yard: YARD,
  street: STREET,
  start: { x: 30, y: 20, heading: 0 },
  obstacles: build(),
  markings: bayLines(),
};
