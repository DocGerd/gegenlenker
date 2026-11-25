import { GraphicsStartError, type GraphicsPreset, type LightingMode } from '../contracts/render';
import { createSceneRenderer, type SceneRenderer } from '../render';
import { currentSettings } from './settings';
import { showNotice } from './notice';

/** Losses within `RECREATE_WINDOW_MS` of each other that still get a fresh renderer; one more asks for a reload. */
const MAX_RECREATES = 3;
const RECREATE_WINDOW_MS = 60_000;

type Shared = {
  /** Holds the current canvas; a loss swaps in a new one, so listeners go here. */
  readonly surface: HTMLElement;
  readonly renderer: SceneRenderer;
  /** Settles when the current canvas's GPU renderer can draw; replaced on a loss. */
  ready: Promise<void>;
  /** Whether a GPU renderer ever started: a later failure is a loss, not a missing API. */
  started: boolean;
  /** Mounted stages, told when `ready` is replaced. */
  readonly lost: Set<() => void>;
};

// One renderer for the whole session: a fresh GPU context per run would hit the browser's context limit.
let shared: Shared | null = null;

function startOnFreshCanvas(s: Shared): Promise<void> {
  const canvas = document.createElement('canvas');
  s.surface.replaceChildren(canvas);
  return s.renderer.init(canvas);
}

const superseded = (error: unknown): boolean =>
  error instanceof GraphicsStartError && error.reason === 'superseded';

function setReady(s: Shared, next: Promise<void>): void {
  s.ready = next;
  // Handled here because no stage may be mounted when it settles.
  next.then(
    () => {
      s.started = true;
    },
    (error: unknown) => {
      if (!superseded(error)) console.error('Graphics could not start', error);
    },
  );
}

/** A hidden page may lose the context again, so a fresh one waits until it is shown. */
function whenVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    const shown = (): void => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', shown);
      resolve();
    };
    document.addEventListener('visibilitychange', shown);
  });
}

function acquireRenderer(): Shared {
  if (shared !== null) return shared;
  const surface = document.createElement('div');
  surface.className = 'drive-surface';
  const renderer = createSceneRenderer();
  const s: Shared = {
    surface,
    renderer,
    ready: Promise.resolve(),
    started: false,
    lost: new Set(),
  };
  setReady(s, startOnFreshCanvas(s));
  let recent = 0;
  let lastLoss = -Infinity;
  renderer.onLost(() => {
    // Browsers drop the contexts of hidden pages; only losses while shown count towards giving up.
    const hidden = document.visibilityState === 'hidden';
    if (!hidden) {
      const now = performance.now();
      recent = now - lastLoss > RECREATE_WINDOW_MS ? 1 : recent + 1;
      lastLoss = now;
    }
    console.warn(`Graphics context lost${hidden ? ' while hidden' : ''}; starting afresh`);
    setReady(
      s,
      recent > MAX_RECREATES
        ? Promise.reject(new Error('graphics lost too often'))
        : whenVisible().then(() => startOnFreshCanvas(s)),
    );
    for (const listener of [...s.lost]) listener();
  });
  shared = s;
  return s;
}

/** Drops a renderer that never started, so the next stage tries again. */
function forget(s: Shared): void {
  if (shared !== s) return;
  shared = null;
  s.renderer.dispose();
}

export type StageHooks = {
  readonly resized: (width: number, height: number) => void;
  /** `seconds` since the previous frame; 0 on the first frame after a pause. */
  readonly frame: (seconds: number) => void;
  /** The renderer came back on a fresh canvas after a loss; redraw. */
  readonly restored: () => void;
  /** The stage stopped for good behind a notice: release what must not outlive the drawing. */
  readonly halted?: () => void;
};

export type RenderStage = {
  readonly renderer: SceneRenderer;
  /** The preset the renderer was set to: read it for anything that must follow the renderer's quality. */
  readonly graphics: GraphicsPreset;
  /** The lighting the stage drew with, which the stored setting does not decide: a replay keeps its run's. */
  readonly lighting: LightingMode;
  /** Fills the host and holds the canvas, which a loss replaces: bind input here. */
  readonly surface: HTMLElement;
  start(hooks: StageHooks): void;
  dispose(): void;
};

/**
 * Puts the shared renderer's surface into `host`, drawn in `lighting`. Frames start once its GPU renderer is ready; if it
 * cannot start, a notice in `stage` offers `onBack`, and a loss it cannot recover from offers a reload.
 */
export function mountRenderStage(
  stage: HTMLElement,
  host: HTMLElement,
  onBack: () => void,
  lighting: LightingMode,
): RenderStage {
  const s = acquireRenderer();
  const { surface, renderer } = s;
  const { graphics } = currentSettings();
  renderer.setQuality(graphics);
  renderer.setLighting(lighting);
  // Read by the e2e; stays after dispose like the renderer's own state, until the next stage sets it.
  document.documentElement.dataset['renderLighting'] = lighting;
  host.append(surface);

  const abort = new AbortController();
  const { signal } = abort;
  let hooks: StageHooks | null = null;
  let raf = 0;
  let last = -1;
  let notice: HTMLElement | null = null;
  let ready = false;
  const back = { label: 'back', run: onBack } as const;

  const loop = (now: number): void => {
    raf = requestAnimationFrame(loop);
    const seconds = last < 0 ? 0 : (now - last) / 1000;
    last = now;
    try {
      hooks?.frame(seconds);
    } catch (error) {
      // The frame left the screen (a finished run) before it threw: the stage can no longer show it.
      if (signal.aborted) throw error;
      // Left to repeat, a throwing frame would freeze the view silently and flood the console.
      console.error('Frame failed', error);
      pause();
      halt(() =>
        showNotice(stage, 'runFailed', { label: 'reload', run: () => location.reload() }, back),
      );
    }
  };
  const resume = (): void => {
    if (raf !== 0 || hooks === null || notice !== null || !ready) return;
    if (document.visibilityState === 'hidden') return;
    last = -1;
    raf = requestAnimationFrame(loop);
  };
  const pause = (): void => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const relayout = (): void => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.resize(width, height);
    hooks?.resized(width, height);
  };
  const observer = new ResizeObserver(relayout);

  const halt = (show: () => HTMLElement): void => {
    if (notice !== null) return;
    notice = show();
    hooks?.halted?.();
  };
  const track = (pending: Promise<void>, recovering: boolean): void => {
    ready = false;
    pause();
    pending.then(
      () => {
        if (signal.aborted || pending !== s.ready) return;
        ready = true;
        if (recovering) hooks?.restored();
        resume();
      },
      (error: unknown) => {
        if (signal.aborted || pending !== s.ready || superseded(error)) return;
        const reload = { label: 'reload', run: () => location.reload() } as const;
        if (s.started) {
          halt(() => showNotice(stage, 'contextLost', reload));
          return;
        }
        forget(s);
        halt(() =>
          error instanceof GraphicsStartError && error.reason === 'unavailable'
            ? showNotice(stage, 'noWebgl', back)
            : showNotice(stage, 'graphicsFailed', reload, back),
        );
      },
    );
  };
  const onLost = (): void => {
    track(s.ready, true);
  };
  s.lost.add(onLost);
  signal.addEventListener('abort', () => s.lost.delete(onLost));
  track(s.ready, false);

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') pause();
      else resume();
    },
    { signal },
  );
  window.addEventListener('orientationchange', relayout, { signal });

  return {
    renderer,
    graphics,
    lighting,
    surface,
    start(next) {
      hooks = next;
      if (notice !== null) next.halted?.();
      observer.observe(host);
      relayout();
      resume();
    },
    dispose() {
      abort.abort();
      observer.disconnect();
      pause();
      hooks = null;
      notice?.remove();
      surface.remove();
    },
  };
}
