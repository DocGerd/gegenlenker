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

const n = (v: number): string => String(Math.round(v * 1000) / 1000);
const points = (line: readonly FigurePoint[]): string =>
  line.map((p) => `${n(p.x)},${n(-p.y)}`).join(' ');
const polyline = (line: readonly FigurePoint[], ghost = false): string =>
  `<polyline points="${points(line)}"${ghost ? ' class="hud-sign-ghost"' : ''} />`;

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
  return `<svg class="hud-sign-figure" viewBox="-0.95 -2.15 1.9 2.2" aria-hidden="true">${[...body, ...arms].join('')}</svg>`;
}
