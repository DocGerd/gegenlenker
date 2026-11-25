import { resolveRun } from '../content/run';
import type { InputLog } from '../contracts/exercise';
import {
  DEFAULT_TOP_DOWN_VIEW,
  type AidFlags,
  type RenderFrame,
  type TopDownMode,
} from '../contracts/render';
import type { Simulation, SimSnapshot } from '../contracts/sim';
import { isFormField } from '../input/keyboard';
import { isAction } from '../input/keymap';
import { createViewInput } from '../input/view-input';
import { isDefaultView } from '../input/top-down-view';
import { formatNumber, formatSeconds, t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { computeViewports } from '../render/viewports';
import { createEventScanner, runStartStep, type ReplayEventKind } from '../scoring/replay-events';
import { createRunTracker, runSeconds, type RunTracker } from '../scoring/score';
import { DT } from '../sim/constants';
import { NO_PREDICTION } from '../sim/predict';
import { createReplayCursor, type ReplayCursor } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { chaseViewAvailable } from '../render';
import { replayContext } from './exercise-text';
import { mountRenderStage } from './render-stage';
import { setNightDrive } from './theme';
import './results.css';
import { isReplayable } from './storage';

const AIDS: AidFlags = { tracks: true, ghost: true, path: false, pivots: false };
// A long frame gap (slow device, backgrounded tab) must not skip a stretch of the run.
const MAX_FRAME_SECONDS = 0.1;
const SPEEDS: readonly number[] = [0.5, 1, 4];
const DEFAULT_SPEED = 1;
const VIEWS: readonly [TopDownMode, MessageKey][] = [
  ['yard', 'viewYard'],
  ['follow', 'viewFollow'],
];
const CHASE_VIEW: readonly [TopDownMode, MessageKey] = ['chase', 'viewChase'];
const EVENT_LABEL: Readonly<Record<ReplayEventKind, MessageKey>> = {
  contact: 'eventContact',
  jackknife: 'eventJackknife',
  stop: 'stop',
  waypoint: 'waypoint',
  reached: 'targetReached',
};
const KMH = 3.6;
// Replaying work per frame is capped so a long log never blocks input or painting.
const WORK_BUDGET_MS = 6;
const WORK_CHUNK_STEPS = 256;

type Frame = { -readonly [K in keyof RenderFrame]: RenderFrame[K] };

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = text;
  el.addEventListener('click', onClick);
  return el;
}

function readoutText(s: SimSnapshot): string {
  const steer = Math.round(Math.abs(s.steer) * 100);
  const side = steer === 0 ? '' : s.steer > 0 ? '←' : '→';
  const parts = [
    `${t('gear')} ${s.control.gear}`,
    `${t('steer')} ${side}${formatNumber(steer, 0)} %`,
    `${formatNumber(Math.abs(s.speed) * KMH, 1)} km/h`,
  ];
  if (s.control.brake) parts.push(t('brake'));
  return parts.join(' · ');
}

/** Moves the cursor toward `goal` until the budget is spent; true once it arrived. */
function advance(cursor: ReplayCursor, goal: number, budgetMs: number): boolean {
  const end = performance.now() + budgetMs;
  if (goal < cursor.step()) cursor.seek(0);
  while (cursor.step() < goal) {
    cursor.seek(Math.min(goal, cursor.step() + WORK_CHUNK_STEPS));
    if (performance.now() >= end) break;
  }
  return cursor.step() >= goal;
}

/** Returns the exit action, which leaves exactly as the back button does. */
export function startReplay(root: HTMLElement, log: InputLog, onExit: () => void): () => void {
  if (!isReplayable(log)) {
    onExit();
    return () => undefined;
  }
  const { params, layout, exercise, start, contacts } = resolveRun(log);
  const makeSim = (): Simulation => createSimulation(params, start, contacts);

  // Scrubbing back rebuilds the run from step 0 across frames; the sim is deterministic, so it lands on the played state.
  let tracker: RunTracker | null = null;
  const cursor = createReplayCursor(log, makeSim, () => {
    tracker = exercise === null ? null : createRunTracker(exercise);
    return (snapshot) => tracker?.update(snapshot);
  });
  // One pass over the log finds the marked moments; it runs across frames after the first paint.
  const scanner = createEventScanner(exercise);
  let scan: ReplayCursor | null = createReplayCursor(
    log,
    makeSim,
    () => (snapshot) => scanner.update(snapshot),
  );
  // Times count from the first driving input, like the result screen.
  const startStep = Math.min(runStartStep(log), log.steps);
  const runLabel = (step: number): string => formatSeconds(runSeconds(step, startStep));
  const total = runLabel(log.steps);

  const stage = document.createElement('div');
  stage.className = 'replay';
  root.append(stage);

  const cleanups: (() => void)[] = [];
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups.reverse()) cleanup();
    stage.remove();
  };
  const exit = (): void => {
    if (disposed) return;
    dispose();
    onExit();
  };

  const map = document.createElement('div');
  map.className = 'replay-map';
  stage.append(map);
  const view = mountRenderStage(stage, map, exit, log.lighting);
  cleanups.push(() => view.dispose());
  setNightDrive(log.lighting === 'night');
  cleanups.push(() => setNightDrive(false));
  const { renderer } = view;
  renderer.setScene(layout, truckById(log.truckId), trailerById(log.trailerId));

  let playing = true;
  let speed = DEFAULT_SPEED;
  let topDown: TopDownMode = 'yard';
  let position = startStep;
  let dirty = true;
  let enterFree = false;
  /** The free camera is flying. */
  let flying = false;

  const bar = document.createElement('div');
  bar.className = 'replay-bar';
  const playButton = button('app-button app-button-primary', '', () => {
    if (!playing && position >= log.steps) position = startStep;
    playing = !playing;
    sync();
  });
  const speedButtons = SPEEDS.map((value) => {
    const el = button('app-button mono', `${formatNumber(value, value < 1 ? 1 : 0)}×`, () => {
      speed = value;
      sync();
    });
    return { el, value };
  });
  const resetButton = button('app-button', t('resetView'), () => viewInput.reset());
  resetButton.disabled = true;
  /** Another view switches to the outside view first; the flight then starts from where it was drawn. */
  const toggleFree = (): void => {
    if (flying) {
      viewInput.setFree(null);
      return;
    }
    if (topDown !== 'chase') {
      topDown = 'chase';
      viewInput.setMode('chase');
    }
    enterFree = !enterFree;
    sync();
  };
  const freeButton = button('app-button', t('freeCamera'), toggleFree);
  freeButton.title = `${t('freeCamera')} (K)`;
  const speedGroup = document.createElement('div');
  speedGroup.className = 'replay-group';
  speedGroup.setAttribute('role', 'group');
  speedGroup.setAttribute('aria-label', t('speed'));
  speedGroup.append(...speedButtons.map((s) => s.el));
  const chase = chaseViewAvailable(view.graphics);
  const views = chase ? [...VIEWS, CHASE_VIEW] : VIEWS;
  const viewButtons = views.map(([mode, label]) => {
    const el = button('app-button', t(label), () => {
      topDown = mode;
      viewInput.setMode(mode);
      sync();
    });
    return { el, mode };
  });
  const viewGroup = document.createElement('div');
  viewGroup.className = 'replay-group';
  viewGroup.setAttribute('role', 'group');
  viewGroup.setAttribute('aria-label', t('labelView'));
  viewGroup.append(...viewButtons.map((v) => v.el));
  const timeLabel = document.createElement('span');
  timeLabel.className = 'replay-time mono';
  const timeline = document.createElement('div');
  timeline.className = 'replay-timeline';
  const markers = document.createElement('div');
  markers.className = 'replay-markers';
  const scrubber = document.createElement('input');
  scrubber.type = 'range';
  scrubber.className = 'replay-scrubber';
  scrubber.min = String(startStep);
  scrubber.max = String(log.steps);
  scrubber.step = '1';
  scrubber.value = String(startStep);
  scrubber.setAttribute('aria-label', t('timeline'));
  // The slider is announced by its time, not the raw step.
  const timeText = (step: number): string => `${runLabel(step)} / ${total}`;
  scrubber.setAttribute('aria-valuetext', timeText(startStep));
  scrubber.addEventListener('input', () => {
    position = Number(scrubber.value);
    scrubber.setAttribute('aria-valuetext', timeText(position));
    dirty = true;
  });
  const addMarkers = (): void => {
    for (const event of scanner.events()) {
      const label = `${t(EVENT_LABEL[event.kind])} · ${runLabel(event.step)}`;
      const marker = button(`replay-marker replay-marker-${event.kind}`, '', () => {
        position = event.step;
        playing = false;
        sync();
      });
      const span = log.steps - startStep;
      marker.style.left = `${span > 0 ? (Math.max(0, event.step - startStep) / span) * 100 : 0}%`;
      marker.title = label;
      marker.setAttribute('aria-label', label);
      markers.append(marker);
    }
  };
  timeline.append(markers, scrubber);
  const title = document.createElement('h1');
  title.className = 'replay-title';
  title.textContent = replayContext(log);
  const readout = document.createElement('div');
  readout.className = 'replay-readout mono';
  const head = document.createElement('div');
  head.className = 'replay-head';
  head.append(title, readout);
  map.append(head);
  bar.append(
    timeline,
    playButton,
    speedGroup,
    viewGroup,
    resetButton,
    ...(chase ? [freeButton] : []),
    button('app-button', t('back'), exit),
    timeLabel,
  );
  stage.append(bar);
  playButton.focus();
  const onEscape = (e: KeyboardEvent): void => {
    if (!isAction('escape', e) || e.repeat || e.defaultPrevented) return;
    e.preventDefault();
    exit();
  };
  window.addEventListener('keydown', onEscape);
  cleanups.push(() => window.removeEventListener('keydown', onEscape));
  const onFreeKey = (e: KeyboardEvent): void => {
    if (!chase || !isAction('freeCamera', e) || e.repeat || e.defaultPrevented) return;
    if (isFormField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    toggleFree();
  };
  window.addEventListener('keydown', onFreeKey);
  cleanups.push(() => window.removeEventListener('keydown', onFreeKey));

  function sync(): void {
    const label: MessageKey = playing ? 'pause' : 'play';
    playButton.textContent = t(label);
    for (const { el, value } of speedButtons)
      el.setAttribute('aria-pressed', String(value === speed));
    for (const { el, mode } of viewButtons)
      el.setAttribute('aria-pressed', String(mode === topDown));
    freeButton.setAttribute('aria-pressed', String(flying || enterFree));
    dirty = true;
  }
  sync();

  const frame: Frame = {
    snapshot: cursor.snapshot(),
    views: computeViewports(1, 1, 'replay'),
    topDown,
    aids: AIDS,
    predicted: NO_PREDICTION,
  };

  const viewInput = createViewInput(view.surface, {
    mode: 'yard',
    getRect: () => frame.views.topDown,
    onChange(next) {
      frame.topDownView = next;
      resetButton.disabled = !flying && isDefaultView(next);
      dirty = true;
    },
    free: {
      bounds: layout.bounds,
      onChange(pose) {
        flying = pose !== null;
        if (pose === null) delete frame.freePose;
        else frame.freePose = pose;
        resetButton.disabled =
          pose === null && isDefaultView(frame.topDownView ?? DEFAULT_TOP_DOWN_VIEW);
        sync();
      },
    },
  });
  cleanups.push(() => viewInput.dispose());

  view.start({
    resized(width, height) {
      frame.views = computeViewports(width, height, 'replay');
      viewInput.relayout();
      dirty = true;
    },
    restored() {
      dirty = true;
    },
    frame(seconds) {
      const dt = Math.min(seconds, MAX_FRAME_SECONDS);
      viewInput.step(dt);
      if (playing) {
        position = Math.min(log.steps, position + (1 / DT) * speed * dt);
        if (position >= log.steps) {
          playing = false;
          sync();
        }
      }
      const before = cursor.step();
      advance(cursor, Math.min(log.steps, Math.floor(position)), WORK_BUDGET_MS);
      const snapshot = cursor.snapshot();
      if (cursor.step() === before && !dirty) {
        // Paused frames report nothing: the idle gap must not count as slow.
        if (playing) renderer.skipFrame();
      } else {
        dirty = false;
        frame.snapshot = snapshot;
        frame.topDown = topDown;
        frame.waypointVisited = tracker?.waypointVisited() ?? false;
        renderer.render(frame);
        if (enterFree) {
          enterFree = false;
          const pose = renderer.chasePose();
          if (pose !== null) viewInput.setFree(pose);
          else sync();
        }
        // Follows the target, not the cursor, so a catching-up rebuild does not drag the thumb.
        scrubber.value = String(Math.min(log.steps, Math.floor(position)));
        timeLabel.textContent = timeText(snapshot.step);
        scrubber.setAttribute('aria-valuetext', timeLabel.textContent);
        readout.textContent = readoutText(snapshot);
      }
      if (scan !== null && advance(scan, log.steps, WORK_BUDGET_MS)) {
        scan = null;
        addMarkers();
      }
    },
  });

  return exit;
}
