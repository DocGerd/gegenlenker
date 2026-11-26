import type { Rect } from '../contracts/render';
import { CHROME_SELECTOR, DIVIDER_SELECTOR } from '../hud/chrome-selector';

/** Rects, relative to `stage`, of the visible elements matching `selector`. */
function measure(stage: HTMLElement, selector: string): Rect[] {
  const origin = stage.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const el of stage.querySelectorAll(selector)) {
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

/** Rects, relative to `stage`, of everything drawn over the scene that the vehicle must stay clear of. */
export const measureChrome = (stage: HTMLElement): Rect[] => measure(stage, CHROME_SELECTOR);

/** Rects, relative to `stage`, of the view-size divider's handle and reset button. */
export const measureDivider = (stage: HTMLElement): Rect[] => measure(stage, DIVIDER_SELECTOR);
