import type { ControlSource } from '../contracts/control';
import type { ExerciseDefinition, RunResult } from '../contracts/exercise';
import type { LightingMode } from '../contracts/render';
import type { SimSnapshot, Simulation } from '../contracts/sim';
import type { TrailerId, TruckId } from '../contracts/vehicle';
import { isDrivingInput, runResult, type RunTracker } from '../scoring/score';
import { DT } from '../sim/constants';
import type { InputRecorder } from '../sim/replay';

/** The Einweiser's say in a run's end; `EinweiserDrive` satisfies it. */
export type RunHooks = {
  settle(after: SimSnapshot): void;
  runOver(): boolean;
  halted(): boolean;
};

export type RunStepper = {
  /** Steps the sim up to `steps` times; stops after the step that ends the run. Returns the latest snapshot. */
  advance(steps: number, source: ControlSource, aidsOn: boolean): SimSnapshot;
  /** The run ended on a step; the caller draws that step, then exits. */
  over(): boolean;
  /** An Einweiser run ended because the vehicle hit him. */
  runOver(): boolean;
  /** Sim time of the first driving input, or null before it. */
  startTime(): number | null;
  result(
    exercise: ExerciseDefinition,
    truckId: TruckId,
    /** Null: the truck solo. */
    trailerId: TrailerId | null,
    lighting: LightingMode,
    mirrorsOnly: boolean,
  ): RunResult;
};

export function createRunStepper(
  sim: Simulation,
  recorder: InputRecorder,
  tracker: RunTracker | null,
  hooks: RunHooks | null,
): RunStepper {
  let snapshot = sim.snapshot();
  let reached = false;
  let runOver = false;
  // Sticky over aid toggles; only sim steps after the first driving input with an aid on count.
  let assisted = false;
  let startTime: number | null = null;
  return {
    advance(steps, source, aidsOn) {
      for (let i = 0; i < steps; i++) {
        source.tick(DT, snapshot);
        const control = source.control();
        recorder.record(snapshot.step, control);
        if (startTime === null && isDrivingInput(control)) startTime = snapshot.time;
        if (startTime !== null && aidsOn) assisted = true;
        snapshot = sim.step(control);
        if (hooks !== null) {
          hooks.settle(snapshot);
          // the hit ends the run, reached or not; the next frame exits
          runOver = hooks.runOver();
          if (runOver) break;
        }
        if (tracker !== null) {
          // an Einweiser run ends only on a stop in the target after a recognised Halt
          reached = tracker.update(snapshot) && (hooks?.halted() ?? true);
          // render this final snapshot first; the next frame exits, so the HUD's last time is the result time
          if (reached) break;
        }
      }
      return snapshot;
    },
    over: () => reached || runOver,
    runOver: () => runOver,
    startTime: () => startTime,
    result: (exercise, truckId, trailerId, lighting, mirrorsOnly) =>
      runResult(
        snapshot,
        exercise,
        truckId,
        trailerId,
        reached,
        tracker?.waypointVisited() ?? true,
        assisted,
        startTime ?? snapshot.time,
        lighting,
        mirrorsOnly,
      ),
  };
}
