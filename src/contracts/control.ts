import type { LampSwitches } from './render';
import type { ControlVector, SimSnapshot } from './sim';

/** Where a run's controls come from: the trainee's input, or a driver model. One `tick`, then one `control()`, per sim step. */
export type ControlSource = {
  tick(dt: number, snapshot: SimSnapshot): void;
  control(): ControlVector;
  /** A new object after each change, so a caller may compare by identity. */
  lamps(): LampSwitches;
};
