import type { ExerciseDefinition } from '../../contracts/exercise';
import { ObstacleBuilder } from '../street';

const CORRIDOR_Y = 30;
const CORRIDOR_CLEAR = 3.6;
const CONE = 0.4;
const CONE_HEIGHT = 0.8;
const CONE_SPACING = 5;
const FROM_X = 8;
const TO_X = 48;
// Turntable only: zero steering then drifts the trailer into the cones, where a coupling bend jackknifes.
const START_TURNTABLE = (0.5 * Math.PI) / 180;

function cones(): ExerciseDefinition['obstacles'] {
  const b = new ObstacleBuilder('ex-');
  const offset = CORRIDOR_CLEAR / 2 + CONE / 2;
  for (let x = FROM_X; x <= TO_X; x += CONE_SPACING) {
    for (const y of [CORRIDOR_Y - offset, CORRIDOR_Y + offset]) {
      b.addBox('cone', x, y, CONE, CONE, 0, CONE_HEIGHT);
    }
  }
  return b.obstacles;
}

export const straightReverse: ExerciseDefinition = {
  id: 'straight-reverse',
  layout: 'depot',
  start: { x: 70, y: CORRIDOR_Y, heading: 0 },
  startArticulation: { coupling: 0, turntable: START_TURNTABLE },
  target: { pose: { x: 10, y: CORRIDOR_Y, heading: 0 }, length: 6, width: 3 },
  tolerances: { position: 0.5, angle: 3 },
  waypoint: null,
  obstacles: cones(),
  markings: [],
};
