import type { ExerciseDefinition } from '../../contracts/exercise';

const BAY_CENTRE_X = 40;
const RAMP_FACE_Y = 49;
const RAMP_GAP = 0.15;

export const dockRamp: ExerciseDefinition = {
  id: 'dock-ramp',
  layout: 'logistics',
  start: { x: 58, y: 26, heading: 0 },
  target: {
    pose: { x: BAY_CENTRE_X, y: RAMP_FACE_Y - RAMP_GAP, heading: -Math.PI / 2 },
    length: 8,
    width: 3,
  },
  tolerances: { position: 0.3, angle: 2 },
  waypoint: null,
  obstacles: [],
  markings: [],
};
