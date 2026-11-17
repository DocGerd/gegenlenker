import type { Rect } from '../contracts/render';

/** HUD panels carry `data-chrome`; the control columns are the parts of controls.css that reach over the top-down view. */
const CHROME = '[data-chrome], .ctl-steer, .ctl-gears, .ctl-pedals';

/** Rects, relative to `stage`, of everything drawn over the scene that the vehicle must stay clear of. */
export function measureChrome(stage: HTMLElement): Rect[] {
  const origin = stage.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const el of stage.querySelectorAll(CHROME)) {
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
