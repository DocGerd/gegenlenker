import type { Rect } from '../contracts/render';
import { CHROME_SELECTOR } from '../hud/chrome-selector';

/** Rects, relative to `stage`, of everything drawn over the scene that the vehicle must stay clear of. */
export function measureChrome(stage: HTMLElement): Rect[] {
  const origin = stage.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const el of stage.querySelectorAll(CHROME_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      rects.push({
        x: r.left - origin.left,
        y: r.top - origin.top,
        width: r.width,
        height: r.height,
      });
    }
  }
  return rects;
}
