import type { RenderStats } from '../contracts/render';

const REFRESH_MS = 250;

export function mountPerfOverlay(root: HTMLElement, stats: () => RenderStats): () => void {
  const el = document.createElement('div');
  el.className = 'mono';
  el.style.cssText = [
    'position:fixed',
    'top:var(--space-2)',
    'left:var(--space-2)',
    'padding:var(--space-1) var(--space-2)',
    'background:var(--color-surface)',
    'color:var(--color-text)',
    'font-size:var(--text-sm)',
    'white-space:pre',
    'pointer-events:none',
    'z-index:10',
  ].join(';');
  root.append(el);
  const refresh = (): void => {
    const s = stats();
    el.textContent =
      `${s.fps.toFixed(0)} fps  p95 ${s.frameP95Ms.toFixed(1)} ms  scale ${s.resolutionScale.toFixed(2)}  calls ${s.drawCalls}` +
      `\n${s.backend}  ${s.glRenderer}${s.contextLost ? '  CONTEXT LOST' : ''}`;
  };
  refresh();
  const timer = window.setInterval(refresh, REFRESH_MS);
  return () => {
    window.clearInterval(timer);
    el.remove();
  };
}
