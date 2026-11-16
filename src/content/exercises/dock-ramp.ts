import type { ExerciseDefinition } from '../../contracts/exercise';
import { BAY_SPACING, RAMP } from '../layouts/logistics';

const BAY_INDEX = 6;
const RAMP_GAP = 0.15;

export const dockRamp: ExerciseDefinition = {
  id: 'dock-ramp',
  layout: 'logistics',
  start: { x: 58, y: 26, heading: 0 },
  target: {
    pose: {
      x: RAMP.minX + (BAY_INDEX + 0.5) * BAY_SPACING,
      y: RAMP.minY - RAMP_GAP,
      heading: -Math.PI / 2,
    },
    length: 8,
    width: 3,
  },
  tolerances: { position: 0.3, angle: 2 },
  waypoint: null,
  obstacles: [],
  markings: [],
};
