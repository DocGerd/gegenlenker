import type { ExerciseDefinition } from '../../contracts/exercise';

const LANE_Y = 20;
const EYE_X = 30;
// Ahead of the eye, lined up with the drawbar, the jaw about 7 m off.
const START_X = 38.5;
// The trailer's rear end at the drop, the trailer towed about 20 m forward.
const DROP_X = 40;

export const coupling: ExerciseDefinition = {
  id: 'coupling',
  layout: 'depot',
  start: { x: START_X, y: LANE_Y, heading: 0 },
  parkedTrailer: { eye: { x: EYE_X, y: LANE_Y }, heading: 0, turntable: 0 },
  target: { pose: { x: DROP_X, y: LANE_Y, heading: 0 }, length: 10, width: 3 },
  tolerances: { position: 0.5, angle: 3 },
  waypoint: null,
  obstacles: [],
  markings: [],
};
