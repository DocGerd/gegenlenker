import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/fonts';
import type { RenderFrame, RenderStats } from '../contracts/render';
import type { Pose2, SimSnapshot } from '../contracts/sim';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { readScenePalette } from './palette';
import { mountPerfOverlay } from './perf-overlay';
import {
  placeholderLayout,
  placeholderParts,
  placeholderTrailer,
  placeholderTruck,
} from './placeholder';
import { createThreeSceneRenderer } from './three-renderer';
import { computeViewports } from './viewports';

declare global {
  interface Window {
    __probe?: { stats: () => RenderStats };
  }
}

const RADIUS = 15;
const SPEED = 1.4;
const COUPLING_ANGLE = 0.0;
const TURNTABLE_ANGLE = 0.0;

const truckAnchor = truckAnchors(placeholderTruck);
const trailerAnchor = trailerAnchors(placeholderTrailer);

const advance = (p: { x: number; y: number }, heading: number, d: number) => ({
  x: p.x + Math.cos(heading) * d,
  y: p.y + Math.sin(heading) * d,
});

/** A snapshot on a circular path with fixed pivot angles, geometrically consistent. */
function snapshotAt(seconds: number): SimSnapshot {
  const phase = (SPEED / RADIUS) * seconds;
  const truck: Pose2 = {
    x: RADIUS * Math.cos(phase),
    y: RADIUS * Math.sin(phase),
    heading: phase + Math.PI / 2,
  };
  const coupling = advance(truck, truck.heading, truckAnchor.coupling.x);
  const dollyHeading = truck.heading - COUPLING_ANGLE;
  const dolly: Pose2 = {
    ...advance(coupling, dollyHeading, -trailerAnchor.eye.x),
    heading: dollyHeading,
  };
  const trailerHeading = dollyHeading - TURNTABLE_ANGLE;
  const trailer: Pose2 = {
    ...advance(dolly, trailerHeading, -trailerAnchor.turntable.x),
    heading: trailerHeading,
  };
  const control = { steer: 0.3, lever: 0.2, brake: false, gear: 'D' } as const;
  return {
    step: Math.round(seconds * 60),
    time: seconds,
    truck,
    coupling,
    dolly,
    trailer,
    trailerRear: advance(trailer, trailerHeading, trailerAnchor.rearX),
    couplingAngle: COUPLING_ANGLE,
    turntableAngle: TURNTABLE_ANGLE,
    steer: control.steer,
    roadWheelAngle: 0.3,
    speed: SPEED,
    control,
    blocked: null,
    contacts: 0,
    jackknifes: 0,
    directionChanges: 0,
  };
}

export function startProbe(root: HTMLElement): void {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  root.append(canvas);

  const renderer = createThreeSceneRenderer(placeholderParts);
  renderer.init(canvas);
  renderer.setScene(placeholderLayout, placeholderTruck, placeholderTrailer, readScenePalette());

  let width = 0;
  let height = 0;
  const fit = (): void => {
    width = window.innerWidth;
    height = window.innerHeight;
    renderer.resize(width, height);
  };
  fit();
  window.addEventListener('resize', fit);

  window.__probe = { stats: () => renderer.stats() };
  mountPerfOverlay(root, () => renderer.stats());

  const tick = (now: number): void => {
    const frame: RenderFrame = {
      snapshot: snapshotAt(now / 1000),
      views: computeViewports(width, height, 'drive'),
      topDown: 'follow',
      aids: { pivots: false, path: false, tracks: false, ghost: false },
      predicted: [],
    };
    renderer.render(frame);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
