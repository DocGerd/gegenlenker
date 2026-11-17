import type { Rect } from '../contracts/render';
import type { Gear, Vec2 } from '../contracts/sim';

/** Space kept between chrome and the clear rect. */
const CHROME_GAP = 8;
/** Zooming out to fit a small clear rect stops at this multiple of the base half-height. */
const MAX_ZOOM_OUT = 3;
/** Metres of way ahead of the leading end the framing makes room for. */
const LOOK_AHEAD = 4;
/** Below this speed the gear decides the travel direction. */
const STANDSTILL = 0.05;

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const sorted = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

/** The largest rect in `pane` that misses every chrome rect; the longest short side wins, then area. */
export function clearRect(pane: Rect, chrome: readonly Rect[]): Rect {
  const blocked = chrome
    .map((r) => ({
      x: r.x - CHROME_GAP,
      y: r.y - CHROME_GAP,
      width: r.width + 2 * CHROME_GAP,
      height: r.height + 2 * CHROME_GAP,
    }))
    .filter((r) => overlaps(r, pane));
  const right = pane.x + pane.width;
  const bottom = pane.y + pane.height;
  const inX = (v: number): number => Math.min(right, Math.max(pane.x, v));
  const inY = (v: number): number => Math.min(bottom, Math.max(pane.y, v));
  const xs = sorted([pane.x, right, ...blocked.flatMap((r) => [inX(r.x), inX(r.x + r.width)])]);
  const ys = sorted([pane.y, bottom, ...blocked.flatMap((r) => [inY(r.y), inY(r.y + r.height)])]);
  let best: Rect | null = null;
  let bestShort = 0;
  let bestArea = 0;
  for (const [i, x0] of xs.entries()) {
    for (const x1 of xs.slice(i + 1)) {
      for (const [j, y0] of ys.entries()) {
        for (const y1 of ys.slice(j + 1)) {
          const r = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
          const short = Math.min(r.width, r.height);
          const area = r.width * r.height;
          if (short < bestShort || (short === bestShort && area <= bestArea)) continue;
          if (blocked.some((b) => overlaps(r, b))) continue;
          best = r;
          bestShort = short;
          bestArea = area;
        }
      }
    }
  }
  return best ?? pane;
}

/**
 * Unit vector (or zero) the leading end travels along: signed speed first, then the selected gear.
 * Forward the truck leads; reversing the trailer rear does, along the trailer's heading.
 */
export function leadTarget(
  truckHeading: number,
  trailerHeading: number,
  speed: number,
  gear: Gear,
): Vec2 {
  let dir = 0;
  if (Math.abs(speed) > STANDSTILL) dir = Math.sign(speed);
  else if (gear === 'R') dir = -1;
  else if (gear === 'D') dir = 1;
  const heading = dir < 0 ? trailerHeading : truckHeading;
  return { x: dir * Math.cos(heading), y: dir * Math.sin(heading) };
}

export type FollowInput = {
  /** Sim-plane point the vehicle's extent is centred on. */
  readonly vehicle: Vec2;
  /** Smoothed travel direction, length at most 1. */
  readonly lead: Vec2;
  /** Metres from `vehicle` that bound the whole vehicle. */
  readonly radius: number;
  readonly pane: Rect;
  /** Inside `pane`, same space. */
  readonly clear: Rect;
  /** Half-height in metres at the default framing. */
  readonly baseHalf: number;
};

/**
 * Camera centre and half-height that keep the vehicle's bounding circle inside `clear`, shifted
 * away from the travel direction by the slack so that more of the way ahead shows. The zoom
 * reserves `LOOK_AHEAD` of that slack, so a tight clear rect still shows the way ahead.
 */
export function followFraming(i: FollowInput): { centre: Vec2; half: number } {
  const { pane, clear, radius } = i;
  const wanted = pane.height / (2 * i.baseHalf);
  const fit = Math.min(clear.width, clear.height) / (2 * (radius + LOOK_AHEAD));
  const half = Math.min(i.baseHalf * MAX_ZOOM_OUT, pane.height / (2 * Math.min(wanted, fit)));
  const scale = pane.height / (2 * half);
  const slackX = Math.max(0, clear.width / 2 - radius * scale);
  const slackY = Math.max(0, clear.height / 2 - radius * scale);
  // Screen offsets from the pane centre; screen y runs down, the sim plane's up.
  const dx = clear.x + clear.width / 2 - pane.x - pane.width / 2 - i.lead.x * slackX;
  const dy = clear.y + clear.height / 2 - pane.y - pane.height / 2 + i.lead.y * slackY;
  return { centre: { x: i.vehicle.x - dx / scale, y: i.vehicle.y + dy / scale }, half };
}

export type YardInput = {
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  readonly pane: Rect;
  /** Inside `pane`, same space. */
  readonly clear: Rect;
};

/** Camera centre and half-height that fit `bounds` entirely into `clear`, centred there. */
export function yardFraming(i: YardInput): { centre: Vec2; half: number } {
  const { bounds, pane, clear } = i;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const scale = Math.min(clear.width / width, clear.height / height);
  const dx = clear.x + clear.width / 2 - pane.x - pane.width / 2;
  const dy = clear.y + clear.height / 2 - pane.y - pane.height / 2;
  return {
    centre: {
      x: (bounds.minX + bounds.maxX) / 2 - dx / scale,
      y: (bounds.minY + bounds.maxY) / 2 + dy / scale,
    },
    half: pane.height / (2 * scale),
  };
}

/** Where the arrow towards a hidden `target` sits and which way it points; null while `target` is inside `clear`. */
export function targetArrow(
  target: Vec2,
  clear: Rect,
  margin: number,
): { x: number; y: number; angle: number } | null {
  const inside =
    target.x >= clear.x &&
    target.x <= clear.x + clear.width &&
    target.y >= clear.y &&
    target.y <= clear.y + clear.height;
  if (inside) return null;
  const cx = clear.x + clear.width / 2;
  const cy = clear.y + clear.height / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  const reachX = Math.max(1, clear.width / 2 - margin);
  const reachY = Math.max(1, clear.height / 2 - margin);
  const t = Math.min(reachX / Math.max(Math.abs(dx), 1e-9), reachY / Math.max(Math.abs(dy), 1e-9));
  return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}
