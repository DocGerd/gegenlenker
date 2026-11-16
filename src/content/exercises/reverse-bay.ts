import type { ExerciseDefinition } from '../../contracts/exercise';
import { ObstacleBuilder } from '../street';

const BAY_X = 72;
const BAY_WIDTH = 4;
const BAY_DEPTH = 16;
const WALL_Y = 2;
const WALL_THICKNESS = 0.3;
const WALL_OFFSET = 1;
const BLOCK_WIDTH = 2.5;
const BLOCK_HEIGHT = 3.5;

function obstacles(): ExerciseDefinition['obstacles'] {
  const b = new ObstacleBuilder('ex-');
  const cy = WALL_Y + BAY_DEPTH / 2;
  for (const side of [-1, 1]) {
    const cx = BAY_X + side * (BAY_WIDTH / 2 + BLOCK_WIDTH / 2);
    b.addBox('parked', cx, cy, BLOCK_WIDTH, BAY_DEPTH, 0, BLOCK_HEIGHT);
  }
  const span = BAY_WIDTH + 2 * BLOCK_WIDTH;
  b.addBox('wall', BAY_X, WALL_Y - WALL_THICKNESS / 2, span, WALL_THICKNESS, 0, 2.5);
  return b.obstacles;
}

export const reverseBay: ExerciseDefinition = {
  id: 'reverse-bay',
  layout: 'logistics',
  start: { x: 50, y: 24, heading: Math.PI },
  target: {
    pose: { x: BAY_X, y: WALL_Y + WALL_OFFSET, heading: Math.PI / 2 },
    length: 8,
    width: 3,
  },
  tolerances: { position: 0.5, angle: 4 },
  waypoint: null,
  obstacles: obstacles(),
  markings: [],
};
