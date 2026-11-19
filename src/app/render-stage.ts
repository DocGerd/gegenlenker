import type { GraphicsPreset, SceneRenderer } from '../contracts/render';
import { createSceneRenderer } from '../render';
import { currentSettings } from './settings';
import { showNotice } from './notice';

/** Fresh GPU renderers after a loss per session; past this the stage asks for a reload. */
const MAX_RECREATES = 3;

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

function startOnFreshCanvas(s: Shared): void {
  const canvas = document.createElement('canvas');
  s.surface.replaceChildren(canvas);
  s.ready = s.renderer.init(canvas);
  // A loss may happen while no stage is mounted to handle the outcome.
  s.ready.catch(() => undefined);
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
  startOnFreshCanvas(s);
  let recreated = 0;
  renderer.onLost(() => {
    recreated++;
    if (recreated <= MAX_RECREATES) startOnFreshCanvas(s);
    else {
      s.ready = Promise.reject(new Error('graphics lost too often'));
      s.ready.catch(() => undefined);
    }
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
};

export type RenderStage = {
  readonly renderer: SceneRenderer;
  /** The preset the renderer was set to: read it for anything that must follow the renderer's quality. */
  readonly graphics: GraphicsPreset;
  /** Fills the host and holds the canvas, which a loss replaces: bind input here. */
  readonly surface: HTMLElement;
  start(hooks: StageHooks): void;
  dispose(): void;
};

/**
 * Puts the shared renderer's surface into `host`. Frames start once its GPU renderer is ready; if it
 * cannot start, a notice in `stage` offers `onBack`, and a loss it cannot recover from offers a reload.
 */
export function mountRenderStage(
  stage: HTMLElement,
  host: HTMLElement,
  onBack: () => void,
): RenderStage {
  const s = acquireRenderer();
  const { surface, renderer } = s;
  const { graphics } = currentSettings();
  renderer.setQuality(graphics);
  host.append(surface);

  const abort = new AbortController();
  const { signal } = abort;
  let hooks: StageHooks | null = null;
  let raf = 0;
  let last = -1;
  let notice: HTMLElement | null = null;
  let ready = false;

  const loop = (now: number): void => {
    raf = requestAnimationFrame(loop);
    const seconds = last < 0 ? 0 : (now - last) / 1000;
    last = now;
    hooks?.frame(seconds);
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

  const track = (pending: Promise<void>, recovering: boolean): void => {
    ready = false;
    pause();
    pending.then(
      () => {
        if (signal.aborted || pending !== s.ready) return;
        s.started = true;
        ready = true;
        if (recovering) hooks?.restored();
        resume();
      },
      () => {
        if (signal.aborted || pending !== s.ready) return;
        if (s.started) {
          notice ??= showNotice(stage, 'contextLost', {
            label: 'reload',
            run: () => location.reload(),
          });
        } else {
          forget(s);
          notice ??= showNotice(stage, 'noWebgl', { label: 'back', run: onBack });
        }
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
    surface,
    start(next) {
      hooks = next;
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
