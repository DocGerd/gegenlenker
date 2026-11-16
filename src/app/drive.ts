import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { ExerciseDefinition, InputLog, RunResult } from '../contracts/exercise';
import type { LayoutId } from '../contracts/layout';
import type { AidFlags, RenderFrame, SceneRenderer } from '../contracts/render';
import type { SimSnapshot, Vec2 } from '../contracts/sim';
import type { TrailerId, TruckId } from '../contracts/vehicle';
import { createHud } from '../hud/hud';
import { t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { createControls } from '../input/controls';
import { proceduralAids } from '../render/aids';
import { proceduralEnvironment } from '../render/environment';
import { readScenePalette } from '../render/palette';
import { mountPerfOverlay } from '../render/perf-overlay';
import { createThreeSceneRenderer } from '../render/three-renderer';
import { proceduralTrailer, proceduralTruck } from '../render/vehicle-visual';
import { computeViewports } from '../render/viewports';
import { createRunTracker, runResult } from '../scoring/score';
import { advanceClock } from '../sim/clock';
import { createContactQuery } from '../sim/collision';
import { DT } from '../sim/constants';
import { predictTrailerRear } from '../sim/predict';
import { createInputRecorder } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { updateSettings, type Settings } from './settings';

export type RunConfig = {
  readonly layoutId: LayoutId;
  readonly exercise: ExerciseDefinition | null;
  readonly truckId: TruckId;
  readonly trailerId: TrailerId;
};

export type DriveOutcome = {
  readonly log: InputLog;
  readonly final: SimSnapshot;
  readonly result: RunResult | null;
};

const PREDICT_DISTANCE = 15;
const NO_PATH: readonly Vec2[] = [];

type Frame = { -readonly [K in keyof RenderFrame]: RenderFrame[K] };

// One renderer and canvas for the whole session: a fresh WebGL context per run would hit the browser's context limit.
let shared: { readonly canvas: HTMLCanvasElement; readonly renderer: SceneRenderer } | null = null;

function acquireRenderer(): NonNullable<typeof shared> {
  if (shared !== null) return shared;
  const canvas = document.createElement('canvas');
  canvas.className = 'drive-canvas';
  const renderer = createThreeSceneRenderer({
    truck: proceduralTruck,
    trailer: proceduralTrailer,
    environment: proceduralEnvironment,
    aids: proceduralAids,
  });
  try {
    renderer.init(canvas);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  shared = { canvas, renderer };
  return shared;
}

function showNotice(
  stage: HTMLElement,
  message: MessageKey,
  action: MessageKey,
  onClick: () => void,
) {
  const box = document.createElement('div');
  box.className = 'app-notice';
  const text = document.createElement('p');
  text.textContent = t(message);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'app-button app-button-primary';
  button.textContent = t(action);
  button.addEventListener('click', onClick);
  box.append(text, button);
  stage.append(box);
}

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
    onExit({ log, final: snapshot, result });
  };

  let gl: NonNullable<typeof shared>;
  try {
    gl = acquireRenderer();
  } catch {
    showNotice(stage, 'noWebgl', 'back', () => exit(false));
    return dispose;
  }
  const { canvas, renderer } = gl;
  const reload = (): void => location.reload();
  // The shared context may have been lost while the menu was showing.
  if (renderer.stats().contextLost) {
    showNotice(stage, 'contextLost', 'reload', reload);
    return dispose;
  }
  stage.append(canvas);
  cleanups.push(() => canvas.remove());
  renderer.setScene(layout, truck, trailer, readScenePalette());

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
      exit(true);
    }
  });

  const frame: Frame = {
    snapshot,
    views: computeViewports(1, 1, 'drive'),
    topDown,
    aids,
    predicted: NO_PATH,
  };

  const relayout = (): void => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width === 0 || height === 0) return;
    frame.views = computeViewports(width, height, 'drive');
    renderer.resize(width, height);
    hud.layout(frame.views);
    dirty = true;
  };
  const observer = new ResizeObserver(relayout);
  observer.observe(stage);
  window.addEventListener('orientationchange', relayout);
  cleanups.push(() => {
    observer.disconnect();
    window.removeEventListener('orientationchange', relayout);
  });
  relayout();

  let raf = 0;
  let last = -1;
  let accumulator = 0;
  let lost = false;

  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick);
    const clock = advanceClock(accumulator, last < 0 ? 0 : (now - last) / 1000);
    last = now;
    accumulator = clock.accumulator;
    for (let i = 0; i < clock.steps; i++) {
      controls.tick(DT);
      const control = controls.control();
      recorder.record(snapshot.step, control);
      snapshot = sim.step(control);
      if (tracker !== null) {
        reached = tracker.update(snapshot);
        if (reached) {
          exit(true);
          return;
        }
      }
    }
    if (clock.steps === 0 && !dirty) return;
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
  };

  const resume = (): void => {
    if (raf !== 0 || disposed || lost) return;
    last = -1;
    raf = requestAnimationFrame(tick);
  };
  const pause = (): void => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') pause();
    else resume();
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    pause();
  });

  // The renderer's own listener runs first (registered in init), so stats() already reports the loss.
  const onLost = (): void => {
    if (!renderer.stats().contextLost) return;
    lost = true;
    pause();
    showNotice(stage, 'contextLost', 'reload', reload);
  };
  canvas.addEventListener('webglcontextlost', onLost);
  cleanups.push(() => canvas.removeEventListener('webglcontextlost', onLost));

  if (new URLSearchParams(location.search).get('perf') === '1') {
    cleanups.push(mountPerfOverlay(stage, () => renderer.stats()));
  }

  if (document.visibilityState !== 'hidden') resume();
  return dispose;
}
