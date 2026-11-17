import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { ExerciseDefinition, InputLog, RunResult } from '../contracts/exercise';
import type { LayoutId } from '../contracts/layout';
import type { AidFlags, RenderFrame } from '../contracts/render';
import type { TrailerId, TruckId } from '../contracts/vehicle';
import { createHud } from '../hud/hud';
import { createControls } from '../input/controls';
import { createTopDownInput } from '../input/top-down-input';
import { isDefaultView } from '../input/top-down-view';
import { mountPerfOverlay } from '../render/perf-overlay';
import { computeViewports } from '../render/viewports';
import { createRunTracker, runResult } from '../scoring/score';
import { advanceClock } from '../sim/clock';
import { createContactQuery } from '../sim/collision';
import { DT } from '../sim/constants';
import { NO_PREDICTION, predictCombination } from '../sim/predict';
import { createInputRecorder } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { showPauseSheet } from './pause-sheet';
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

type Frame = { -readonly [K in keyof RenderFrame]: RenderFrame[K] };

export type DriveHandlers = {
  readonly onExit: (outcome: DriveOutcome) => void;
  /** The run was dropped unscored and unrecorded. */
  readonly onRestart: () => void;
};

/** Returns the back action: opens the pause sheet, closes it when open, or leaves when no stage could mount. */
export function startDrive(
  root: HTMLElement,
  run: RunConfig,
  settings: Settings,
  { onExit, onRestart }: DriveHandlers,
): () => void {
  const truck = truckById(run.truckId);
  const trailer = trailerById(run.trailerId);
  const params = resolveCombination(truck, trailer);
  const layout = resolveLayout(layouts[run.layoutId], run.exercise);
  const exercise = run.exercise;
  const contacts = createContactQuery(layout.obstacles);
  const sim = createSimulation(
    params,
    { truck: exercise?.start ?? layouts[run.layoutId].start },
    contacts,
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
  const restart = (): void => {
    if (disposed) return;
    dispose();
    onRestart();
  };

  // The sim stands still while the sheet is open; rendering carries on for resizes.
  let closeSheet: (() => void) | null = null;
  const resume = (): void => {
    closeSheet?.();
    closeSheet = null;
  };
  const togglePause = (): void => {
    if (closeSheet !== null) {
      resume();
      return;
    }
    closeSheet = showPauseSheet(stage, exercise === null ? 'menu' : 'finish', {
      continue: resume,
      restart,
      finish,
    });
  };

  const view = mountRenderStage(stage, stage, () => exit(false));
  if (view === null) return () => exit(false);
  cleanups.push(() => view.dispose());
  const { renderer } = view;
  renderer.setScene(layout, truck, trailer);

  let aids: AidFlags = settings.aids;
  let topDown = settings.topDown;
  // Set by anything visual besides a sim step; a frame with neither is not redrawn.
  let dirty = true;
  let pathStale = true;
  const frame: Frame = {
    snapshot,
    views: computeViewports(1, 1, 'drive'),
    topDown,
    aids,
    predicted: NO_PREDICTION,
  };

  const controls = createControls(stage, {
    lockToLockTurns: truck.steering.lockToLockTurns.value,
    steerRate: params.steerRate,
  });
  cleanups.push(() => controls.dispose());
  // Created before the HUD, whose keydown listener relies on defaultPrevented marking a handled key.
  const viewInput = createTopDownInput(view.canvas, {
    mode: topDown,
    getRect: () => frame.views.topDown,
    onChange(next) {
      frame.topDownView = next;
      dirty = true;
      hud.setViewChanged(!isDefaultView(next));
    },
  });
  cleanups.push(() => viewInput.dispose());
  const hud = createHud(stage, {
    couplingLimit: params.couplingLimit,
    turntableLimit: params.turntableLimit,
    mode: exercise === null ? 'yard' : 'exercise',
    aids: settings.aids,
    topDown: settings.topDown,
  });
  cleanups.push(() => hud.dispose());

  hud.onAction((action) => {
    if (action.type === 'topDown') {
      topDown = action.mode;
      viewInput.setMode(topDown);
      dirty = true;
      updateSettings({ topDown });
    } else if (action.type === 'resetView') {
      viewInput.reset();
    } else if (action.type === 'aid') {
      aids = { ...aids, [action.aid]: action.on };
      dirty = true;
      pathStale = true;
      updateSettings({ aids });
    } else if (closeSheet === null) {
      togglePause();
    }
  });

  let accumulator = 0;
  view.start({
    resized(width, height) {
      frame.views = computeViewports(width, height, 'drive');
      hud.layout(frame.views);
      viewInput.relayout();
      dirty = true;
    },
    restored() {
      dirty = true;
    },
    frame(seconds) {
      const clock =
        closeSheet === null ? advanceClock(accumulator, seconds) : { steps: 0, accumulator };
      accumulator = clock.accumulator;
      for (let i = 0; i < clock.steps; i++) {
        controls.tick(DT, snapshot.steer);
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
        frame.predicted = aids.path
          ? predictCombination(params, snapshot, contacts)
          : NO_PREDICTION;
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

  return togglePause;
}
