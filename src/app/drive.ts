import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { ExerciseDefinition, InputLog, RunResult } from '../contracts/exercise';
import type { LayoutId } from '../contracts/layout';
import type { AidFlags, RenderFrame } from '../contracts/render';
import type { Vec2 } from '../contracts/sim';
import type { TrailerId, TruckId } from '../contracts/vehicle';
import { createHud } from '../hud/hud';
import { createControls } from '../input/controls';
import { mountPerfOverlay } from '../render/perf-overlay';
import { computeViewports } from '../render/viewports';
import { createRunTracker, runResult } from '../scoring/score';
import { advanceClock } from '../sim/clock';
import { createContactQuery } from '../sim/collision';
import { DT, PREDICT_DISTANCE } from '../sim/constants';
import { predictTrailerRear } from '../sim/predict';
import { createInputRecorder } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { mountRenderStage } from './render-stage';
import { updateSettings, type Settings } from './settings';

export type RunConfig = {
  readonly layoutId: LayoutId;
  readonly exercise: ExerciseDefinition | null;
  readonly truckId: TruckId;
  readonly trailerId: TrailerId;
};

export type DriveOutcome = {
  readonly log: InputLog;
  readonly result: RunResult | null;
};

const NO_PATH: readonly Vec2[] = [];

type Frame = { -readonly [K in keyof RenderFrame]: RenderFrame[K] };

/** Returns the finish action, which ends the run exactly as the HUD's finish button does. */
export function startDrive(
  root: HTMLElement,
  run: RunConfig,
  settings: Settings,
  onExit: (outcome: DriveOutcome) => void,
): () => void {
  const truck = truckById(run.truckId);
  const trailer = trailerById(run.trailerId);
  const params = resolveCombination(truck, trailer);
  const layout = resolveLayout(layouts[run.layoutId], run.exercise);
  const exercise = run.exercise;
  const sim = createSimulation(
    params,
    { truck: exercise?.start ?? layouts[run.layoutId].start },
    createContactQuery(layout.obstacles),
  );
  const recorder = createInputRecorder();
  const tracker = exercise === null ? null : createRunTracker(exercise);
  let snapshot = sim.snapshot();
  let reached = false;

  const stage = document.createElement('div');
  stage.className = 'drive';
  root.append(stage);

  const cleanups: (() => void)[] = [];
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups.reverse()) cleanup();
    stage.remove();
  };

  const exit = (scored: boolean): void => {
    if (disposed) return;
    const log = recorder.finish(
      {
        layoutId: run.layoutId,
        exerciseId: exercise?.id ?? null,
        truckId: run.truckId,
        trailerId: run.trailerId,
      },
      snapshot.step,
    );
    const result =
      scored && exercise !== null
        ? runResult(snapshot, exercise, run.truckId, run.trailerId, reached)
        : null;
    dispose();
    onExit({ log, result });
  };
  const finish = (): void => exit(true);

  const view = mountRenderStage(stage, stage, () => exit(false));
  if (view === null) return () => exit(false);
  cleanups.push(() => view.dispose());
  const { renderer } = view;
  renderer.setScene(layout, truck, trailer);

  const controls = createControls(stage, {
    lockToLockTurns: truck.steering.lockToLockTurns.value,
    steerRate: params.steerRate,
  });
  cleanups.push(() => controls.dispose());
  const hud = createHud(stage, {
    couplingLimit: params.couplingLimit,
    turntableLimit: params.turntableLimit,
    mode: exercise === null ? 'yard' : 'exercise',
    aids: settings.aids,
    topDown: settings.topDown,
  });
  cleanups.push(() => hud.dispose());

  let aids: AidFlags = settings.aids;
  let topDown = settings.topDown;
  // Set by anything visual besides a sim step; a frame with neither is not redrawn.
  let dirty = true;
  let pathStale = true;
  hud.onAction((action) => {
    if (action.type === 'topDown') {
      topDown = action.mode;
      dirty = true;
      updateSettings({ topDown });
    } else if (action.type === 'aid') {
      aids = { ...aids, [action.aid]: action.on };
      dirty = true;
      pathStale = true;
      updateSettings({ aids });
    } else {
      finish();
    }
  });

  const frame: Frame = {
    snapshot,
    views: computeViewports(1, 1, 'drive'),
    topDown,
    aids,
    predicted: NO_PATH,
  };

  let accumulator = 0;
  view.start({
    resized(width, height) {
      frame.views = computeViewports(width, height, 'drive');
      hud.layout(frame.views);
      dirty = true;
    },
    restored() {
      dirty = true;
    },
    frame(seconds) {
      const clock = advanceClock(accumulator, seconds);
      accumulator = clock.accumulator;
      for (let i = 0; i < clock.steps; i++) {
        controls.tick(DT);
        const control = controls.control();
        recorder.record(snapshot.step, control);
        snapshot = sim.step(control);
        if (tracker !== null) {
          reached = tracker.update(snapshot);
          if (reached) {
            finish();
            return;
          }
        }
      }
      if (clock.steps === 0 && !dirty) {
        renderer.skipFrame();
        return;
      }
      dirty = false;
      if (clock.steps > 0 || pathStale) {
        pathStale = false;
        const gear = snapshot.control.gear;
        frame.predicted =
          aids.path && (gear === 'D' || gear === 'R')
            ? predictTrailerRear(params, snapshot, gear === 'D' ? 1 : -1, PREDICT_DISTANCE)
            : NO_PATH;
      }
      frame.snapshot = snapshot;
      frame.topDown = topDown;
      frame.aids = aids;
      renderer.render(frame);
      hud.update(snapshot);
    },
  });

  if (new URLSearchParams(location.search).get('perf') === '1') {
    cleanups.push(mountPerfOverlay(stage, () => renderer.stats()));
  }

  return finish;
}
