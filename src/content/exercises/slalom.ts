import type { ExerciseDefinition } from '../../contracts/exercise';
import { ObstacleBuilder } from '../street';

export const LANE = { minY: 14, maxY: 26, fromX: 2, toX: 98 };
const KERB = 0.15;
const KERB_HEIGHT = 0.15;
const CONE = 0.4;
const CONE_HEIGHT = 0.8;
const CONES_PER_BARRIER = 7;
const BARRIER_SPAN = 6.4;
// Each barrier reaches past the lane centre, so alternating barriers overlap in y and force a weave.
export const BARRIER_X = [28, 48, 68, 88] as const;

function obstacles(): ExerciseDefinition['obstacles'] {
  const b = new ObstacleBuilder('ex-');
  const { minY, maxY, fromX, toX } = LANE;
  b.addRect('kerb', { minX: fromX, minY: minY - KERB, maxX: toX, maxY: minY }, KERB_HEIGHT);
  b.addRect('kerb', { minX: fromX, minY: maxY, maxX: toX, maxY: maxY + KERB }, KERB_HEIGHT);

  const pitch = (BARRIER_SPAN - CONE) / (CONES_PER_BARRIER - 1);
  BARRIER_X.forEach((x, i) => {
    const fromSouth = i % 2 === 0;
    for (let c = 0; c < CONES_PER_BARRIER; c++) {
      const y = fromSouth ? minY + CONE / 2 + c * pitch : maxY - CONE / 2 - c * pitch;
      b.addBox('cone', x, y, CONE, CONE, 0, CONE_HEIGHT);
    }
  });
  return b.obstacles;
}

export const slalom: ExerciseDefinition = {
  id: 'slalom',
  layout: 'depot',
  start: { x: 16, y: 20, heading: 0 },
  target: { pose: { x: 2.5, y: 20, heading: 0 }, length: 6, width: 3 },
  tolerances: { position: 1, angle: 6 },
  waypoint: { x: 92, y: 20 },
  obstacles: obstacles(),
  markings: [],
};
