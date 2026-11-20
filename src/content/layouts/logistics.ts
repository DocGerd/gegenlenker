import type { Layout, Marking } from '../../contracts/layout';
import { kitBackedTo } from '../kit';
import { numberMarkings, solidLine } from '../markings';
import { plotDecor } from '../plot';
import {
  addBollardProp,
  addEntranceFurniture,
  addGate,
  addLamps,
  addPlotFences,
  addYardEdge,
  BOUNDS,
  ObstacleBuilder,
  PropBuilder,
  STREET,
  YARD,
} from '../street';

const WALL_THICKNESS = 0.3;
const WALL_HEIGHT = 2.5;
const HALL = { minX: 10, minY: 52, maxX: 74, maxY: 68 };
const HALL_HEIGHT = 8;
export const RAMP = { minX: 14, minY: 49, maxX: 70, maxY: 52 };
const RAMP_HEIGHT = 1.2;
const RAMP_BOLLARD_OFFSET = 1; // beyond each ramp end
const BACK_GAP = 0.05;
const HALL_BINS = [
  { piece: 'bin-1100', x: HALL.minX, y: 57, heading: Math.PI / 2 },
  { piece: 'bin-240', x: HALL.minX, y: 59.2, heading: Math.PI / 2 },
  { piece: 'bin-1100', x: HALL.maxX, y: 57, heading: -Math.PI / 2 },
  { piece: 'bin-240', x: HALL.maxX, y: 59.2, heading: -Math.PI / 2 },
] as const; // on the hall's end faces, outside the ramp
const HYDRANT = { x: 72.5, y: 51.2 }; // beside the east end of the ramp
export const BAY_SPACING = 4;
const BAY_LINE_LENGTH = 18;
const BAY_LINE_WIDTH = 0.12;
const TRAILER = { width: 2.5, length: 13.6, height: 4 };
const TRAILER_X = [82, 86.5, 91, 95.5];
const TRAILER_PITCH = 4.5;
const TRAILER_Y = 45;
const DOCK_NUMBER_HEIGHT = 1.4;
const DOCK_NUMBER_OFFSET = 1.5; // below the ramp edge
const PARKING_LINE_WIDTH = 0.12;
const PARKING_LINE_OVERHANG = 0.75; // beyond the trailer ends

function obstacles(): Layout['obstacles'] {
  const b = new ObstacleBuilder('');
  addYardEdge(b, 'wall', WALL_THICKNESS, WALL_HEIGHT, STREET.entrance);
  return b.obstacles;
}

function props(): Layout['props'] {
  const p = new PropBuilder();
  p.add('hall', (b) => {
    b.addRect('hall', HALL, HALL_HEIGHT);
    b.addRect('ramp', RAMP, RAMP_HEIGHT);
  });
  for (const x of TRAILER_X) {
    p.add('parked', (b) =>
      b.addBox('parked', x, TRAILER_Y, TRAILER.width, TRAILER.length, 0, TRAILER.height),
    );
  }
  addLamps(p, STREET);
  addGate(p, STREET);
  for (const x of [RAMP.minX - RAMP_BOLLARD_OFFSET, RAMP.maxX + RAMP_BOLLARD_OFFSET]) {
    addBollardProp(p, x, RAMP.minY + RAMP_BOLLARD_OFFSET / 2);
  }
  for (const { piece, x, y, heading } of HALL_BINS) {
    const [bx, by] = kitBackedTo(piece, x, y, heading, BACK_GAP);
    p.addKit(piece, 'furniture', bx, by, heading);
  }
  p.addKit('hydrant', 'furniture', HYDRANT.x, HYDRANT.y, 0);
  addEntranceFurniture(p, STREET);
  addPlotFences(p, STREET);
  return p.props;
}

function bayLines(): Marking[] {
  const lines: Marking[] = [];
  for (let x = RAMP.minX; x <= RAMP.maxX; x += BAY_SPACING) {
    lines.push(solidLine('bay', x, RAMP.minY, x, RAMP.minY - BAY_LINE_LENGTH, BAY_LINE_WIDTH));
    if (x < RAMP.maxX) {
      lines.push(
        ...numberMarkings(
          String((x - RAMP.minX) / BAY_SPACING + 1),
          'dock-number',
          x + BAY_SPACING / 2,
          RAMP.minY - DOCK_NUMBER_OFFSET - DOCK_NUMBER_HEIGHT / 2,
          DOCK_NUMBER_HEIGHT,
        ),
      );
    }
  }
  return lines;
}

/** Lines between and beside the parked trailers. */
function parkingLines(): Marking[] {
  const y0 = TRAILER_Y - TRAILER.length / 2 - PARKING_LINE_OVERHANG;
  const y1 = TRAILER_Y + TRAILER.length / 2 + PARKING_LINE_OVERHANG;
  const xs = [
    ...TRAILER_X.map((x) => x - TRAILER_PITCH / 2),
    Math.max(...TRAILER_X) + TRAILER_PITCH / 2,
  ];
  return xs.map((x) => solidLine('bay', x, y0, x, y1, PARKING_LINE_WIDTH));
}

export const logistics: Layout = {
  id: 'logistics',
  bounds: BOUNDS,
  yard: YARD,
  street: STREET,
  start: { x: 30, y: 20, heading: 0 },
  obstacles: obstacles(),
  props: props(),
  decor: plotDecor(YARD),
  markings: [...bayLines(), ...parkingLines()],
};
