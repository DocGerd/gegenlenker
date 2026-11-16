import type { ExerciseDefinition } from '../../contracts/exercise';
import { ObstacleBuilder } from '../street';

const LANE_WIDTH = 9;
const KERB = 0.15;
const KERB_HEIGHT = 0.15;
const KERB_RADIUS = 6;
const ARC_SEGMENTS = 6;
const CORNER = { x: 12, y: 14 };
const LEG1_END_X = 62;
const LEG2_END_Y = 52;
const LEG2_DEPTH = 15;

const innerX = CORNER.x + LANE_WIDTH;
const innerY = CORNER.y + LANE_WIDTH;

function obstacles(): ExerciseDefinition['obstacles'] {
  const b = new ObstacleBuilder('ex-');
  const { x: x0, y: y0 } = CORNER;
  b.addRect('kerb', { minX: x0 - KERB, minY: y0 - KERB, maxX: LEG1_END_X, maxY: y0 }, KERB_HEIGHT);
  b.addRect('kerb', { minX: x0 - KERB, minY: y0, maxX: x0, maxY: LEG2_END_Y }, KERB_HEIGHT);

  // Inner kerb: straight runs joined by a quarter arc around (cx, cy), kerb sits outside the lane.
  const cx = innerX + KERB_RADIUS;
  const cy = innerY + KERB_RADIUS;
  b.addRect('kerb', { minX: cx, minY: innerY, maxX: LEG1_END_X, maxY: innerY + KERB }, KERB_HEIGHT);
  b.addRect('kerb', { minX: innerX, minY: cy, maxX: innerX + KERB, maxY: LEG2_END_Y }, KERB_HEIGHT);
  const r = KERB_RADIUS - KERB / 2;
  const point = (i: number): [number, number] => {
    const angle = -Math.PI / 2 - (i / ARC_SEGMENTS) * (Math.PI / 2);
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };
  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const [ax, ay] = point(i);
    const [bx, by] = point(i + 1);
    b.addSegment('kerb', ax, ay, bx, by, KERB, KERB_HEIGHT);
  }
  return b.obstacles;
}

export const reverseCorner: ExerciseDefinition = {
  id: 'reverse-corner',
  layout: 'depot',
  start: { x: 50, y: CORNER.y + LANE_WIDTH / 2, heading: 0 },
  target: {
    pose: { x: CORNER.x + LANE_WIDTH / 2, y: innerY + LEG2_DEPTH, heading: -Math.PI / 2 },
    length: 6,
    width: 3,
  },
  tolerances: { position: 0.7, angle: 5 },
  waypoint: null,
  obstacles: obstacles(),
  markings: [],
};
