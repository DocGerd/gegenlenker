import { resolveRun } from '../content/run';
import type { ExerciseDefinition, InputLog, RunResult } from '../contracts/exercise';
import type { LayoutId } from '../contracts/layout';
import {
  DEFAULT_TOP_DOWN_LAYOUT,
  TOP_DOWN_SHARE_LIMITS,
  type AidFlags,
  type RenderFrame,
  type TopDownMode,
} from '../contracts/render';
import type { TrailerId, TruckId } from '../contracts/vehicle';
import { createHud } from '../hud/hud';
import { t } from '../i18n/i18n';
import { createControls } from '../input/controls';
import { isAction } from '../input/keymap';
import { createViewInput } from '../input/view-input';
import { isDefaultView } from '../input/top-down-view';
import { chaseViewAvailable, extraMirrors, interiorAvailable } from '../render';
import { clearRect, targetArrow } from '../render/follow-framing';
import { mountPerfOverlay, perfRequested } from '../render/perf-overlay';
import { computeViewports, orientationOf, topDownSplit } from '../render/viewports';
import { holdWakeLock } from '../pwa/wake-lock';
import { createRunTracker, isDrivingInput, runResult } from '../scoring/score';
import { advanceClock } from '../sim/clock';
import { bodyFootprints } from '../sim/geometry';
import { CONTACT_WARN_DISTANCE, DT } from '../sim/constants';
import { contactAhead, NO_PREDICTION, predictCombination } from '../sim/predict';
import { createInputRecorder } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { measureChrome } from './chrome';
import { EXERCISE_BRIEF, EXERCISE_TITLE } from './exercise-text';
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

/** Margin between the target arrow and the edge of the clear rect, in px. */
const ARROW_MARGIN = 24;
const EXPOSE_FRAMING = new URLSearchParams(location.search).get('framing') === '1';

const anyAid = (a: AidFlags): boolean => a.pivots || a.path || a.tracks || a.ghost;

type Frame = { -readonly [K in keyof RenderFrame]: RenderFrame[K] };

export type DriveHandlers = {
  readonly onExit: (outcome: DriveOutcome) => void;
  /** The run was dropped unscored and unrecorded. */
  readonly onRestart: () => void;
  /** The run was left unscored; nothing is stored. */
  readonly onLeave: () => void;
};

/** Returns the back action: opens the pause sheet, or closes it when open. */
export function startDrive(
  root: HTMLElement,
  run: RunConfig,
  settings: Settings,
  { onExit, onRestart, onLeave }: DriveHandlers,
): () => void {
  const { params, layout, exercise, start, contacts } = resolveRun({
    layoutId: run.layoutId,
    exerciseId: run.exercise?.id ?? null,
    truckId: run.truckId,
    trailerId: run.trailerId,
  });
  const truck = truckById(run.truckId);
  const trailer = trailerById(run.trailerId);
  const sim = createSimulation(params, { truck: start }, contacts);
  const { lighting } = settings;
  const recorder = createInputRecorder();
  const tracker = exercise === null ? null : createRunTracker(exercise);
  let snapshot = sim.snapshot();
  let reached = false;
  // Sticky over aid toggles; only sim steps after the first driving input with an aid on count.
  let assisted = false;
  let startTime: number | null = null;

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
        lighting,
      },
      snapshot.step,
    );
    const result =
      scored && exercise !== null
        ? runResult(
            snapshot,
            exercise,
            run.truckId,
            run.trailerId,
            reached,
            tracker?.waypointVisited() ?? true,
            assisted,
            startTime ?? snapshot.time,
            lighting,
          )
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
  const leaveUnscored = (): void => {
    if (disposed) return;
    dispose();
    onLeave();
  };

  // The sim stands still while the sheet is open; rendering carries on for resizes.
  let closeSheet: (() => void) | null = null;
  const resume = (): void => {
    closeSheet?.();
    closeSheet = null;
  };
  cleanups.push(resume);
  const togglePause = (): void => {
    if (closeSheet !== null) {
      resume();
      return;
    }
    closeSheet = showPauseSheet(stage, exercise === null ? 'menu' : 'finish', {
      continue: resume,
      restart,
      finish,
      leave: exercise === null ? null : leaveUnscored,
    });
  };

  const view = mountRenderStage(stage, stage, () => exit(false), lighting);
  cleanups.push(() => view.dispose());
  // Released early when the stage halts behind a notice: nothing may drive or hold the screen under it.
  const live: (() => void)[] = [];
  const halt = (): void => {
    for (const release of live.splice(0).reverse()) release();
  };
  cleanups.push(halt);
  live.push(resume, holdWakeLock());
  const onEscape = (e: KeyboardEvent): void => {
    if (!isAction('escape', e) || e.repeat || e.defaultPrevented) return;
    e.preventDefault();
    togglePause();
  };
  window.addEventListener('keydown', onEscape);
  live.push(() => window.removeEventListener('keydown', onEscape));
  const { renderer, graphics } = view;
  renderer.setScene(layout, truck, trailer);

  let aids: AidFlags = settings.aids;
  let collapsed = settings.collapsed;
  let topDownLayout = settings.topDownLayout;
  let savedLayout = topDownLayout;
  let topDown: TopDownMode = settings.topDown;
  // Set by anything visual besides a sim step; a frame with neither is not redrawn.
  let dirty = true;
  let pathStale = true;
  let warnContact = false;
  const frame: Frame = {
    snapshot,
    views: computeViewports(
      1,
      1,
      'drive',
      null,
      undefined,
      undefined,
      null,
      extraMirrors(graphics, settings.wideMirrors),
    ),
    topDown,
    aids,
    predicted: NO_PREDICTION,
  };

  const controls = createControls(stage, {
    lockToLockTurns: truck.steering.lockToLockTurns.value,
    steerRate: params.steerRate,
    lights: lighting === 'night',
  });
  live.push(() => controls.dispose());
  // Created before the HUD, whose keydown listener relies on defaultPrevented marking a handled key.
  const viewInput = createViewInput(view.surface, {
    mode: topDown,
    getRect: () => frame.views.topDown,
    onChange(next) {
      frame.topDownView = next;
      dirty = true;
      hud.setViewChanged(!isDefaultView(next));
    },
  });
  live.push(() => viewInput.dispose());
  const hud = createHud(stage, {
    couplingLimit: params.couplingLimit,
    turntableLimit: params.turntableLimit,
    mode: exercise === null ? 'yard' : 'exercise',
    exercise:
      exercise === null
        ? null
        : { title: t(EXERCISE_TITLE[exercise.id]), brief: t(EXERCISE_BRIEF[exercise.id]) },
    aids: settings.aids,
    topDown,
    chase: chaseViewAvailable(graphics),
    interior: interiorAvailable(graphics),
    collapsed,
  });
  cleanups.push(() => hud.dispose());

  /** Chrome moves with the layout and with collapsing panels; the vehicle is framed in what it leaves free. */
  const remeasure = (): void => {
    frame.topDownClear = clearRect(frame.views.topDown, measureChrome(stage));
    dirty = true;
  };
  const target = layout.target;
  const targetCentre =
    target === null
      ? null
      : {
          x: target.pose.x + (Math.cos(target.pose.heading) * target.length) / 2,
          y: target.pose.y + (Math.sin(target.pose.heading) * target.length) / 2,
        };
  /** Test observable (`?framing=1`): the screen box of the drawn vehicle and the sim step it shows. */
  const exposeVehicleBox = (): void => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const { obb } of bodyFootprints(params, snapshot)) {
      const c = Math.cos(obb.heading);
      const sn = Math.sin(obb.heading);
      for (const [a, b] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const ox = a * obb.halfLength;
        const oy = b * obb.halfWidth;
        const p = renderer.project(obb.cx + ox * c - oy * sn, obb.cy + ox * sn + oy * c);
        if (p === null) continue;
        xs.push(p.x);
        ys.push(p.y);
      }
    }
    if (xs.length === 0) {
      delete stage.dataset['vehicleBox'];
      return;
    }
    const box = {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
      step: snapshot.step,
    };
    stage.dataset['vehicleBox'] = JSON.stringify(box);
  };

  let size: { width: number; height: number } | null = null;
  /** The legend's size depends on the cockpit rect, so it is measured after a first layout and the mirrors then clear it. */
  const arrange = (): void => {
    if (size === null) return;
    const { width, height } = size;
    // One measurement per pane width for this layout pass; each forces a layout.
    const measured = new Map<number, number>();
    const panels = (paneWidth: number): number => {
      const known = measured.get(paneWidth);
      if (known !== undefined) return known;
      const bottom = hud.panelsBottom(paneWidth);
      measured.set(paneWidth, bottom);
      return bottom;
    };
    const extra = extraMirrors(graphics, settings.wideMirrors);
    let views = computeViewports(
      width,
      height,
      'drive',
      null,
      undefined,
      topDownLayout,
      panels,
      extra,
    );
    hud.layout(views);
    const legend = hud.legendBox();
    if (legend !== null) {
      views = computeViewports(
        width,
        height,
        'drive',
        legend,
        undefined,
        topDownLayout,
        panels,
        extra,
      );
      hud.layout(views);
    }
    hud.setSplit(topDownSplit(width, height, topDownLayout, legend, undefined, panels));
    frame.views = views;
    viewInput.relayout();
    remeasure();
  };
  hud.onLegendResize(arrange);

  hud.onAction((action) => {
    if (action.type === 'topDown') {
      topDown = action.mode;
      viewInput.setMode(topDown);
      dirty = true;
      if (topDown !== 'chase') updateSettings({ topDown });
    } else if (action.type === 'resetView') {
      viewInput.reset();
    } else if (action.type === 'split' || action.type === 'splitReset') {
      if (size === null) return;
      const reset = action.type === 'splitReset';
      const orientation = reset ? orientationOf(size.width, size.height) : action.orientation;
      // The user's choice, within what any screen allows; the screen's own range applies where it is used.
      const { min, max } = TOP_DOWN_SHARE_LIMITS[orientation];
      const proposed = reset ? DEFAULT_TOP_DOWN_LAYOUT[orientation] : action.share;
      const share = Math.min(max, Math.max(min, proposed));
      topDownLayout = { ...topDownLayout, [orientation]: share };
      if ((reset || action.commit) && share !== savedLayout[orientation]) {
        savedLayout = { ...savedLayout, [orientation]: share };
        updateSettings({ topDownLayout: savedLayout });
      }
      arrange();
    } else if (action.type === 'aidLegend') {
      arrange();
    } else if (action.type === 'collapse') {
      collapsed = { ...collapsed, [action.panel]: action.collapsed };
      updateSettings({ collapsed });
      arrange();
    } else if (action.type === 'aid') {
      aids = { ...aids, [action.aid]: action.on };
      dirty = true;
      pathStale = true;
      updateSettings({ aids });
      arrange();
    } else if (closeSheet === null) {
      togglePause();
    }
  });

  let accumulator = 0;
  view.start({
    resized(width, height) {
      size = { width, height };
      arrange();
    },
    restored() {
      dirty = true;
    },
    halted: halt,
    frame(seconds) {
      if (reached) {
        finish();
        return;
      }
      const clock =
        closeSheet === null ? advanceClock(accumulator, seconds) : { steps: 0, accumulator };
      accumulator = clock.accumulator;
      for (let i = 0; i < clock.steps; i++) {
        controls.tick(DT, snapshot.steer);
        const control = controls.control();
        recorder.record(snapshot.step, control);
        if (startTime === null && isDrivingInput(control)) startTime = snapshot.time;
        if (startTime !== null && anyAid(aids)) assisted = true;
        snapshot = sim.step(control);
        if (tracker !== null) {
          reached = tracker.update(snapshot);
          // render this final snapshot first; the next frame exits, so the HUD's last time is the result time
          if (reached) break;
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
        // the warning does not depend on the path aid, so a short look-ahead stands in when it is off
        const ahead = aids.path
          ? frame.predicted
          : predictCombination(params, snapshot, contacts, CONTACT_WARN_DISTANCE);
        warnContact = snapshot.speed !== 0 && contactAhead(ahead);
      }
      frame.snapshot = snapshot;
      frame.waypointVisited = tracker?.waypointVisited() ?? false;
      frame.topDown = topDown;
      frame.aids = aids;
      frame.lamps = controls.lamps();
      renderer.render(frame);
      hud.update(snapshot, warnContact);
      hud.setRunTime(startTime === null ? 0 : snapshot.time - startTime);
      if (tracker !== null) hud.setGoal(tracker.goal(snapshot));
      const at = targetCentre && renderer.project(targetCentre.x, targetCentre.y);
      hud.setTargetArrow(
        at && frame.topDownClear ? targetArrow(at, frame.topDownClear, ARROW_MARGIN) : null,
      );
      if (EXPOSE_FRAMING) exposeVehicleBox();
    },
  });

  if (perfRequested(location.search)) {
    cleanups.push(mountPerfOverlay(stage, () => renderer.stats()));
  }

  return togglePause;
}
