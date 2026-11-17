import { exerciseById, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { InputLog } from '../contracts/exercise';
import type { AidFlags, RenderFrame } from '../contracts/render';
import type { Simulation, Vec2 } from '../contracts/sim';
import { formatNumber, t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { readScenePalette } from '../render/palette';
import { computeViewports } from '../render/viewports';
import { createContactQuery } from '../sim/collision';
import { DT } from '../sim/constants';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { acquireRenderer, showNotice } from './drive';
import './results.css';
import { isReplayable } from './storage';

const AIDS: AidFlags = { tracks: true, ghost: true, path: false, pivots: false };
const NO_PATH: readonly Vec2[] = [];
// A long frame gap (slow device, backgrounded tab) must not skip a stretch of the run.
const MAX_FRAME_SECONDS = 0.1;
const SPEEDS: readonly number[] = [1, 4];

type Frame = { -readonly [K in keyof RenderFrame]: RenderFrame[K] };

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = text;
  el.addEventListener('click', onClick);
  return el;
}

export function startReplay(root: HTMLElement, log: InputLog, onExit: () => void): () => void {
  if (!isReplayable(log)) {
    onExit();
    return () => undefined;
  }
  const truck = truckById(log.truckId);
  const trailer = trailerById(log.trailerId);
  const params = resolveCombination(truck, trailer);
  const exercise = log.exerciseId === null ? null : exerciseById(log.exerciseId);
  const layout = resolveLayout(layouts[log.layoutId], exercise);
  const makeSim = (): Simulation =>
    createSimulation(
      params,
      { truck: exercise?.start ?? layouts[log.layoutId].start },
      createContactQuery(layout.obstacles),
    );

  // Playback only moves forward, so the run is stepped lazily and one snapshot is held.
  let sim = makeSim();
  let snapshot = sim.snapshot();
  let stepped = 0;
  let nextChange = 0;
  let control = snapshot.control;
  const advanceTo = (target: number): void => {
    while (stepped < target) {
      for (let change = log.changes[nextChange]; change !== undefined && change.step <= stepped;) {
        control = change.control;
        change = log.changes[++nextChange];
      }
      snapshot = sim.step(control);
      stepped++;
    }
  };
  const restart = (): void => {
    sim = makeSim();
    snapshot = sim.snapshot();
    stepped = 0;
    nextChange = 0;
    control = snapshot.control;
    position = 0;
  };
  const total = `${formatNumber(log.steps * DT, 1)} s`;

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

  let gl: ReturnType<typeof acquireRenderer>;
  try {
    gl = acquireRenderer();
  } catch {
    showNotice(stage, 'noWebgl', 'back', exit);
    return dispose;
  }
  const { canvas, renderer } = gl;
  if (renderer.stats().contextLost) {
    showNotice(stage, 'contextLost', 'reload', () => location.reload());
    return dispose;
  }
  const map = document.createElement('div');
  map.className = 'replay-map';
  map.append(canvas);
  stage.append(map);
  cleanups.push(() => canvas.remove());
  renderer.setScene(layout, truck, trailer, readScenePalette());

  let playing = true;
  let speed = SPEEDS[0] ?? 1;
  let position = 0;
  let dirty = true;

  const bar = document.createElement('div');
  bar.className = 'replay-bar';
  const playButton = button('app-button app-button-primary', '', () => {
    if (!playing && position >= log.steps) restart();
    playing = !playing;
    sync();
  });
  const speedButtons = SPEEDS.map((value) => {
    const el = button('app-button mono', `${value}×`, () => {
      speed = value;
      sync();
    });
    return { el, value };
  });
  const speedGroup = document.createElement('div');
  speedGroup.className = 'replay-group';
  speedGroup.setAttribute('role', 'group');
  speedGroup.setAttribute('aria-label', t('speed'));
  speedGroup.append(...speedButtons.map((s) => s.el));
  const timeLabel = document.createElement('span');
  timeLabel.className = 'replay-time mono';
  bar.append(playButton, speedGroup, button('app-button', t('back'), exit), timeLabel);
  stage.append(bar);

  function sync(): void {
    const label: MessageKey = playing ? 'pause' : 'play';
    playButton.textContent = t(label);
    for (const { el, value } of speedButtons)
      el.setAttribute('aria-pressed', String(value === speed));
    dirty = true;
  }
  sync();

  const frame: Frame = {
    snapshot,
    views: computeViewports(1, 1, 'replay'),
    topDown: 'yard',
    aids: AIDS,
    predicted: NO_PATH,
  };

  const relayout = (): void => {
    const width = map.clientWidth;
    const height = map.clientHeight;
    if (width === 0 || height === 0) return;
    frame.views = computeViewports(width, height, 'replay');
    renderer.resize(width, height);
    dirty = true;
  };
  const observer = new ResizeObserver(relayout);
  observer.observe(map);
  window.addEventListener('orientationchange', relayout);
  cleanups.push(() => {
    observer.disconnect();
    window.removeEventListener('orientationchange', relayout);
  });
  relayout();

  let raf = 0;
  let last = -1;
  let lost = false;
  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick);
    const dt = last < 0 ? 0 : Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
    last = now;
    if (playing) {
      position = Math.min(log.steps, position + (1 / DT) * speed * dt);
      if (position >= log.steps) {
        playing = false;
        sync();
      }
    }
    const before = stepped;
    advanceTo(Math.floor(position));
    if (stepped === before && !dirty) {
      // Paused frames report nothing: the idle gap must not count as slow.
      if (playing) renderer.skipFrame();
      return;
    }
    dirty = false;
    frame.snapshot = snapshot;
    renderer.render(frame);
    timeLabel.textContent = `${formatNumber(snapshot.time, 1)} / ${total}`;
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
    showNotice(stage, 'contextLost', 'reload', () => location.reload());
  };
  canvas.addEventListener('webglcontextlost', onLost);
  cleanups.push(() => canvas.removeEventListener('webglcontextlost', onLost));

  if (document.visibilityState !== 'hidden') resume();
  return dispose;
}
