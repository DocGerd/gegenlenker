import type { SceneRenderer } from '../contracts/render';
import { createSceneRenderer } from '../render';
import { showNotice } from './notice';

// One renderer and canvas for the whole session: a fresh WebGL context per run would hit the browser's context limit.
let shared: { readonly canvas: HTMLCanvasElement; readonly renderer: SceneRenderer } | null = null;

function acquireRenderer(): NonNullable<typeof shared> {
  if (shared !== null) return shared;
  const canvas = document.createElement('canvas');
  canvas.className = 'drive-canvas';
  const renderer = createSceneRenderer();
  try {
    renderer.init(canvas);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  shared = { canvas, renderer };
  return shared;
}

export type StageHooks = {
  readonly resized: (width: number, height: number) => void;
  /** `seconds` since the previous frame; 0 on the first frame after a pause. */
  readonly frame: (seconds: number) => void;
  readonly restored: () => void;
};

export type RenderStage = {
  readonly renderer: SceneRenderer;
  start(hooks: StageHooks): void;
  dispose(): void;
};

/** Puts the shared canvas into `host`; null after showing a notice in `stage` when WebGL 2 is unavailable. */
export function mountRenderStage(
  stage: HTMLElement,
  host: HTMLElement,
  onBack: () => void,
): RenderStage | null {
  let gl: NonNullable<typeof shared>;
  try {
    gl = acquireRenderer();
  } catch {
    showNotice(stage, 'noWebgl', 'back', onBack);
    return null;
  }
  const { canvas, renderer } = gl;
  host.append(canvas);

  const abort = new AbortController();
  const { signal } = abort;
  let hooks: StageHooks | null = null;
  let raf = 0;
  let last = -1;
  let notice: HTMLElement | null = null;

  const loop = (now: number): void => {
    raf = requestAnimationFrame(loop);
    const seconds = last < 0 ? 0 : (now - last) / 1000;
    last = now;
    hooks?.frame(seconds);
  };
  const resume = (): void => {
    if (raf !== 0 || hooks === null || notice !== null) return;
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
  const lose = (): void => {
    pause();
    notice ??= showNotice(stage, 'contextLost', 'reload', () => location.reload());
  };
  const observer = new ResizeObserver(relayout);

  // The renderer's own listeners run first (registered in init), so stats() already reflects the event.
  canvas.addEventListener(
    'webglcontextlost',
    () => {
      if (renderer.stats().contextLost) lose();
    },
    { signal },
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      if (renderer.stats().contextLost) return;
      notice?.remove();
      notice = null;
      hooks?.restored();
      resume();
    },
    { signal },
  );
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
    start(next) {
      hooks = next;
      observer.observe(host);
      relayout();
      // The shared context may have been lost while no stage was showing.
      if (renderer.stats().contextLost) lose();
      else resume();
    },
    dispose() {
      abort.abort();
      observer.disconnect();
      pause();
      hooks = null;
      notice?.remove();
      canvas.remove();
    },
  };
}
