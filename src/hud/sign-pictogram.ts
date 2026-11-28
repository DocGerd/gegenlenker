import type { SignId } from '../contracts/einweiser';
import {
  FOREARM,
  SHOULDER_HALF_SPAN,
  SHOULDER_HEIGHT,
  SIGN_POSES,
  UPPER_ARM,
  type BodyPose,
  type Segment,
} from '../einweiser/sign-poses';

/** A point of the figure in metres: `x` to the viewer's right, `y` up from the ground. */
export type FigurePoint = { readonly x: number; readonly y: number };

/** Figure measures, metres (estimates). */
const HEAD_HEIGHT = 1.62;
const HEAD_RADIUS = 0.11;
const NECK = 1.47;
const HIP = 0.95;
const FOOT_SPREAD = 0.14;

/**
 * Shoulder, elbow and hand of each arm in a front view, as the driver facing him sees it: his left arm
 * stands on the viewer's right.
 */
export function armLines(body: BodyPose): readonly (readonly FigurePoint[])[] {
  return (['left', 'right'] as const).map((side) => {
    const s = side === 'left' ? 1 : -1;
    const across = (seg: Segment, length: number): FigurePoint => ({
      x: s * length * Math.cos(seg.up) * Math.sin(seg.out),
      y: length * Math.sin(seg.up),
    });
    const { upper, fore } = body[side];
    const shoulder = { x: s * SHOULDER_HALF_SPAN, y: SHOULDER_HEIGHT };
    const u = across(upper, UPPER_ARM);
    const elbow = { x: shoulder.x + u.x, y: shoulder.y + u.y };
    const f = across(fore, FOREARM);
    return [shoulder, elbow, { x: elbow.x + f.x, y: elbow.y + f.y }];
  });
}

/**
 * The steering signs' wheel before his chest, as the driver facing him sees it: the arc runs the way its
 * top turns (toward his left is clockwise here), longer for full lock; straight marks its top.
 */
const WHEEL = { y: 1.22, r: 0.32 } as const;
const STEER_CUE: Readonly<
  Partial<Record<SignId, { readonly turn: 1 | -1; readonly sweep: number } | 'straight'>>
> = {
  lenkenLinks: { turn: 1, sweep: 100 },
  lenkenLinksVoll: { turn: 1, sweep: 250 },
  lenkenRechts: { turn: -1, sweep: 100 },
  lenkenRechtsVoll: { turn: -1, sweep: 250 },
  lenkenGerade: 'straight',
};

const n = (v: number): string => String(Math.round(v * 1000) / 1000);
const points = (line: readonly FigurePoint[]): string =>
  line.map((p) => `${n(p.x)},${n(-p.y)}`).join(' ');
const polyline = (line: readonly FigurePoint[], ghost = false): string =>
  `<polyline points="${points(line)}"${ghost ? ' class="hud-sign-ghost"' : ''} />`;

/** A point on the wheel `deg` degrees clockwise (as seen) from its top, in SVG coordinates. */
const onWheel = (deg: number, r: number = WHEEL.r): FigurePoint => {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.sin(a), y: -WHEEL.y - r * Math.cos(a) };
};

/** The wheel and its turn for a steering sign; empty for every other sign. */
export function steerCue(sign: SignId): string {
  const cue = STEER_CUE[sign];
  if (cue === undefined) return '';
  const rim = `<circle class="hud-sign-wheel" cx="0" cy="${n(-WHEEL.y)}" r="${n(WHEEL.r)}" />`;
  if (cue === 'straight') {
    const [a, b] = [onWheel(0, WHEEL.r * 0.55), onWheel(0, WHEEL.r * 1.45)];
    return `${rim}<path class="hud-sign-cue" d="M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}" />`;
  }
  const { turn, sweep } = cue;
  const [from, to] = [-turn * (sweep / 2), turn * (sweep / 2)];
  const [a, b] = [onWheel(from), onWheel(to)];
  const large = sweep > 180 ? 1 : 0;
  const clockwise = turn === 1 ? 1 : 0;
  // the head: two strokes back along the arc's tangent at its end
  const head = [-1, 1].map((side) => {
    const back = onWheel(to - turn * 28, WHEEL.r * (1 + side * 0.22));
    return `M${n(b.x)} ${n(b.y)}L${n(back.x)} ${n(back.y)}`;
  });
  return `${rim}<path class="hud-sign-cue" d="M${n(a.x)} ${n(a.y)}A${n(WHEEL.r)} ${n(WHEEL.r)} 0 ${large} ${clockwise} ${n(b.x)} ${n(b.y)}${head.join('')}" />`;
}

/** The source pose of `sign` as a stick figure on `currentColor`; a moving sign draws its other keys fainter. */
export function signPictogram(sign: SignId): string {
  // the first key last, so it lies on top
  const keys = [...SIGN_POSES[sign].keys].reverse();
  const body = [
    `<circle cx="0" cy="${n(-HEAD_HEIGHT)}" r="${n(HEAD_RADIUS)}" />`,
    polyline([-1, 1].map((s) => ({ x: s * SHOULDER_HALF_SPAN, y: SHOULDER_HEIGHT }))),
    polyline([
      { x: 0, y: NECK },
      { x: 0, y: HIP },
    ]),
    polyline([-1, 0, 1].map((s) => ({ x: s * FOOT_SPREAD, y: s === 0 ? HIP : 0 }))),
  ];
  const arms = keys.flatMap((key, i) =>
    armLines(key).map((arm) => polyline(arm, i < keys.length - 1)),
  );
  return `<svg class="hud-sign-figure" viewBox="-0.95 -2.15 1.9 2.2" aria-hidden="true">${[...body, ...arms].join('')}${steerCue(sign)}</svg>`;
}
