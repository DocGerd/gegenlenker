import { resolveRun } from '../content/run';
import type { ControlSource } from '../contracts/control';
import type { ExerciseDefinition, InputLog, Role, RunResult } from '../contracts/exercise';
import type { LayoutId } from '../contracts/layout';
import {
  DEFAULT_TOP_DOWN_LAYOUT,
  DEFAULT_TOP_DOWN_VIEW,
  TOP_DOWN_SHARE_LIMITS,
  type AidFlags,
  type GraphicsPreset,
  type Rect,
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
import {
  chaseViewAvailable,
  extraMirrors,
  interiorAvailable,
  lookAroundAvailable,
} from '../render';
import { arrowClearRect, clearRect, targetArrow } from '../render/follow-framing';
import { mountPerfOverlay, perfRequested } from '../render/perf-overlay';
import { computeViewports, orientationOf, topDownSplit } from '../render/viewports';
import { holdWakeLock } from '../pwa/wake-lock';
import { createRunTracker, isDrivingInput, runResult } from '../scoring/score';
import { advanceClock } from '../sim/clock';
import { bodyFootprints } from '../sim/geometry';
import { CONTACT_WARN_DISTANCE, DT } from '../sim/constants';
import { NO_PREDICTION, predictCombination, warnAhead, type Ahead } from '../sim/predict';
import { createInputRecorder } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { measureChrome, measureDivider } from './chrome';
import { startEinweiserDrive } from './einweiser-drive';
import { EXERCISE_BRIEF, EXERCISE_TITLE } from './exercise-text';
import { pauseFields } from './menu/options';
import { showPauseSheet, type PauseSheet } from './pause-sheet';
import { mountRenderStage } from './render-stage';
import { setNightDrive } from './theme';
import { currentSettings, updateSettings, type Settings } from './settings';

export type RunConfig = {
  readonly layoutId: LayoutId;
  readonly exercise: ExerciseDefinition | null;
  readonly truckId: TruckId;
  readonly trailerId: TrailerId;
  /** Absent: a driver run. */
  readonly role?: Role;
};

export type DriveOutcome = {
  readonly log: InputLog;
  readonly result: RunResult | null;
  /** An Einweiser run ended because the vehicle hit him. */
  readonly runOver: boolean;
};

/** Margin between the target arrow and the edge of the clear rect, in px. */
const ARROW_MARGIN = 24;
const EXPOSE_FRAMING = new URLSearchParams(location.search).get('framing') === '1';

const anyAid = (a: AidFlags): boolean => a.pivots || a.path || a.tracks || a.ghost;
/** Every aid draws in the top-down view only, so a mirror-only run has none, whatever the settings. */
const NO_AIDS: AidFlags = { pivots: false, path: false, tracks: false, ghost: false };

type Frame = { -readonly [K in keyof RenderFrame]: RenderFrame[K] };

export type DriveHandlers = {
  readonly onExit: (outcome: DriveOutcome) => void;
  /** The run was dropped unscored and unrecorded. */
  readonly onRestart: () => void;
  /** The run was left unscored; nothing is stored. */
  readonly onLeave: () => void;
};

/** Returns the back action: opens the pause sheet, steps back from its Settings, or closes it. */
export function startDrive(
  root: HTMLElement,
  run: RunConfig,
  settings: Settings,
  { onExit, onRestart, onLeave }: DriveHandlers,
): () => void {
  const role: Role = run.role ?? 'driver';
  const { params, layout, exercise, start, contacts } = resolveRun({
    layoutId: run.layoutId,
    exerciseId: run.exercise?.id ?? null,
    truckId: run.truckId,
    trailerId: run.trailerId,
    role,
  });
  const truck = truckById(run.truckId);
  const trailer = trailerById(run.trailerId);
  const sim = createSimulation(params, start, contacts);
  const { lighting, mirrorsOnly } = settings;
  const recorder = createInputRecorder();
  const tracker = exercise === null ? null : createRunTracker(exercise);
  let snapshot = sim.snapshot();
  let reached = false;
  let runOver = false;
  // Sticky over aid toggles; only sim steps after the first driving input with an aid on count.
  let assisted = false;
  let startTime: number | null = null;

  const stage = document.createElement('div');
  stage.className = 'drive';
  root.append(stage);
  const einweiser =
    role === 'einweiser'
      ? startEinweiserDrive(stage, { truck, trailer, layout, contacts, start: snapshot, lighting })
      : null;

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
        role,
        lighting,
        mirrorsOnly,
        ...(einweiser === null ? {} : { einweiser: einweiser.track() }),
      },
      snapshot.step,
    );
    const driven =
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
            mirrorsOnly,
          )
        : null;
    const result =
      driven === null || einweiser === null ? driven : { ...driven, einweiser: einweiser.result() };
    dispose();
    onExit({ log, result, runOver });
  };
  const finish = (): void => exit(true);
  const restart = (): void => {
    if (disposed) return;
    dispose();
    // The next drive mounts asynchronously; a light frame in between would flash at night. `leave` and `loadFailed` clear it.
    setNightDrive(lighting === 'night');
    onRestart();
  };
  const leaveUnscored = (): void => {
    if (disposed) return;
    dispose();
    onLeave();
  };

  // The sim stands still while the sheet is open; rendering carries on for resizes.
  let sheet: PauseSheet | null = null;
  const resume = (): void => {
    sheet?.close();
    sheet = null;
  };
  cleanups.push(resume);
  const togglePause = (): void => {
    if (sheet !== null) {
      if (!sheet.back()) resume();
      return;
    }
    sheet = showPauseSheet(stage, exercise === null ? 'menu' : 'finish', {
      continue: resume,
      restart,
      finish,
      leave: exercise === null ? null : leaveUnscored,
      fields: pauseFields(role),
      settingChanged: (id) => {
        if (id === 'graphics') switchGraphics(currentSettings().graphics);
        // the field of view is the first-person camera's: redraw while the run stands still
        if (id === 'fov') {
          frame.fov = currentSettings().fov;
          dirty = true;
        }
        if (id !== 'wideMirrors') return;
        wideMirrors = currentSettings().wideMirrors;
        arrange();
      },
    });
    einweiser?.pause();
  };

  const view = mountRenderStage(stage, stage, () => exit(false), lighting);
  cleanups.push(() => view.dispose());
  setNightDrive(lighting === 'night');
  cleanups.push(() => setNightDrive(false));
  // Released early when the stage halts behind a notice: nothing may drive or hold the screen under it.
  const live: (() => void)[] = [];
  const halt = (): void => {
    for (const release of live.splice(0).reverse()) release();
  };
  cleanups.push(halt);
  live.push(resume, holdWakeLock());
  // Before the view input and the HUD, whose keys and clicks it takes first.
  if (einweiser !== null) {
    live.push(
      einweiser.attach(view.surface, () => {
        if (sheet === null) togglePause();
      }),
    );
  }
  const onEscape = (e: KeyboardEvent): void => {
    if (!isAction('escape', e) || e.repeat || e.defaultPrevented) return;
    e.preventDefault();
    togglePause();
  };
  window.addEventListener('keydown', onEscape);
  live.push(() => window.removeEventListener('keydown', onEscape));
  const { renderer } = view;
  // The pause sheet can change it during the drive.
  let graphics = view.graphics;
  renderer.setScene(layout, truck, trailer);
  // Set by anything visual besides a sim step; a frame with neither is not redrawn.
  let dirty = true;
  // An asset that lands while the run is paused must still show.
  cleanups.push(
    renderer.onAttached(() => {
      dirty = true;
    }),
  );

  // His look is the mouse's, and he has no outside view (`docs/einweiser-spike.md` §3.1, §3.4).
  const chaseOffered = (g: GraphicsPreset): boolean => role === 'driver' && chaseViewAvailable(g);
  const lookOffered = (g: GraphicsPreset): boolean => role === 'driver' && lookAroundAvailable(g);

  const driveMode = mirrorsOnly ? 'mirrors' : 'drive';
  let aids: AidFlags = mirrorsOnly ? NO_AIDS : settings.aids;
  let collapsed = settings.collapsed;
  let topDownLayout = settings.topDownLayout;
  let savedLayout = topDownLayout;
  let topDown: TopDownMode = settings.topDown;
  // The pause sheet can change it during the drive.
  let wideMirrors = settings.wideMirrors;
  let pathStale = true;
  let warning: Ahead = null;
  const frame: Frame = {
    snapshot,
    views: computeViewports(
      1,
      1,
      driveMode,
      null,
      undefined,
      undefined,
      null,
      extraMirrors(graphics, wideMirrors),
      role,
    ),
    topDown,
    aids,
    predicted: NO_PREDICTION,
    fov: settings.fov,
  };

  // The Einweiser has no wheel, lever or driver keys.
  const controls =
    einweiser === null
      ? createControls(stage, {
          lockToLockTurns: truck.steering.lockToLockTurns.value,
          steerRate: params.steerRate,
          lights: lighting === 'night',
        })
      : null;
  if (controls !== null) live.push(() => controls.dispose());
  const source: ControlSource | undefined = einweiser?.source ?? controls ?? undefined;
  if (source === undefined) throw new Error('a drive has a control source');
  // Created before the HUD, whose keydown listener relies on defaultPrevented marking a handled key.
  const viewInput = createViewInput(view.surface, {
    mode: topDown,
    getRect: () => frame.views.topDown,
    onChange(next) {
      // The keys still move a view that has no pane.
      if (mirrorsOnly) return;
      frame.topDownView = next;
      dirty = true;
      hud.setViewChanged(!isDefaultView(next));
    },
    free: {
      bounds: layout.bounds,
      onChange(pose) {
        if (pose === null) delete frame.freePose;
        else frame.freePose = pose;
        dirty = true;
        hud.setFree(pose !== null);
        hud.setViewChanged(
          pose !== null || !isDefaultView(frame.topDownView ?? DEFAULT_TOP_DOWN_VIEW),
        );
      },
    },
    look: {
      getRect: () => frame.views.cockpit,
      enabled: lookOffered(graphics),
      onChange(head) {
        frame.head = head;
        if (EXPOSE_FRAMING) stage.dataset['head'] = JSON.stringify(head);
        dirty = true;
      },
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
    aids,
    topDown,
    chase: chaseOffered(graphics),
    interior: interiorAvailable(graphics),
    look: lookOffered(graphics),
    collapsed,
    mirrorsOnly,
    role,
    ...(controls === null ? {} : { pedalsBox: () => controls.pedalsBox() }),
  });
  cleanups.push(() => hud.dispose());

  /** Chrome moves with the layout and with collapsing panels; the vehicle is framed in what it leaves free. */
  let arrowRects: { clear: Rect; place: Rect } | null = null;
  const remeasure = (): void => {
    if (mirrorsOnly) return;
    const chrome = measureChrome(stage);
    const clear = clearRect(frame.views.topDown, chrome);
    frame.topDownClear = clear;
    arrowRects = {
      clear,
      place: arrowClearRect(frame.views.topDown, chrome, measureDivider(stage)),
    };
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
  /** Test observable (`?framing=1`), beside `drawn` (frames drawn) and `head`: the screen box of the drawn vehicle and the sim step it shows. */
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
    const extra = extraMirrors(graphics, wideMirrors);
    let views = computeViewports(
      width,
      height,
      driveMode,
      null,
      undefined,
      topDownLayout,
      panels,
      extra,
      role,
    );
    hud.layout(views);
    const legend = hud.legendBox();
    if (legend !== null) {
      views = computeViewports(
        width,
        height,
        driveMode,
        legend,
        undefined,
        topDownLayout,
        panels,
        extra,
        role,
      );
      hud.layout(views);
    }
    if (!mirrorsOnly) {
      hud.setSplit(topDownSplit(width, height, topDownLayout, legend, undefined, panels));
    }
    frame.views = views;
    viewInput.relayout();
    remeasure();
    // remeasure marks it only with a top-down pane
    dirty = true;
  };
  hud.onLegendResize(arrange);

  /** Rebuilds the scene under `next`; the sim, run, views and wheel tracks carry on. */
  const switchGraphics = (next: GraphicsPreset): void => {
    if (next === graphics) return;
    graphics = next;
    view.setGraphics(next);
    renderer.rebuildScene();
    viewInput.setLook(lookOffered(next));
    hud.setOffers({
      chase: chaseOffered(next),
      interior: interiorAvailable(next),
      look: lookOffered(next),
    });
    dirty = true;
    arrange();
  };

  hud.onAction((action) => {
    if (action.type === 'topDown') {
      topDown = action.mode;
      viewInput.setMode(topDown);
      dirty = true;
      if (topDown !== 'chase') updateSettings({ topDown });
      // the free camera button comes and goes with the outside view: the chrome the vehicle is framed clear of changes
      arrange();
    } else if (action.type === 'resetView') {
      viewInput.reset();
    } else if (action.type === 'freeCamera') {
      // the flight starts from where the outside view's camera was drawn, once the next frame has
      if (frame.freePose !== undefined) {
        viewInput.setFree(null);
      } else {
        enterFree = !enterFree;
        hud.setFree(enterFree);
      }
      dirty = true;
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
    } else if (action.type === 'aidLegend' || action.type === 'brief') {
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
    } else if (sheet === null) {
      togglePause();
    }
  });

  let accumulator = 0;
  let drawn = 0;
  let enterFree = false;
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
      if (reached || runOver) {
        finish();
        return;
      }
      viewInput.step(seconds);
      const clock = sheet === null ? advanceClock(accumulator, seconds) : { steps: 0, accumulator };
      accumulator = clock.accumulator;
      for (let i = 0; i < clock.steps; i++) {
        source.tick(DT, snapshot);
        const control = source.control();
        recorder.record(snapshot.step, control);
        if (startTime === null && isDrivingInput(control)) startTime = snapshot.time;
        if (startTime !== null && anyAid(aids)) assisted = true;
        snapshot = sim.step(control);
        if (einweiser !== null) {
          einweiser.settle(snapshot);
          // the hit ends the run, reached or not; the next frame exits
          runOver = einweiser.runOver();
          if (runOver) break;
        }
        if (tracker !== null) {
          // an Einweiser run ends only on a stop in the target after a recognised Halt
          reached = tracker.update(snapshot) && (einweiser?.halted() ?? true);
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
        warning = snapshot.speed !== 0 ? warnAhead(ahead) : null;
      }
      frame.snapshot = snapshot;
      frame.waypointVisited = tracker?.waypointVisited() ?? false;
      frame.topDown = topDown;
      frame.aids = aids;
      frame.lamps = source.lamps();
      const visual = einweiser?.visual() ?? null;
      if (visual !== null) frame.einweiser = visual;
      renderer.render(frame);
      drawn++;
      if (enterFree) {
        enterFree = false;
        const pose = renderer.chasePose();
        if (pose !== null) viewInput.setFree(pose);
        else hud.setFree(false);
      }
      hud.update(snapshot, warning);
      if (einweiser !== null) hud.setEinweiser(einweiser.hud());
      hud.setRunTime(startTime === null ? 0 : snapshot.time - startTime);
      if (tracker !== null) hud.setGoal(tracker.goalCue(snapshot));
      const at = targetCentre && renderer.project(targetCentre.x, targetCentre.y);
      hud.setTargetArrow(
        at && arrowRects ? targetArrow(at, arrowRects.clear, ARROW_MARGIN, arrowRects.place) : null,
      );
      if (EXPOSE_FRAMING) {
        exposeVehicleBox();
        stage.dataset['drawn'] = String(drawn);
        if (visual !== null) stage.dataset['einweiser'] = JSON.stringify(visual);
      }
    },
  });

  if (perfRequested(location.search)) {
    cleanups.push(mountPerfOverlay(stage, () => renderer.stats()));
  }

  return togglePause;
}
