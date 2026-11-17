import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/fonts';
import { exerciseById, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { RenderFrame, RenderStats } from '../contracts/render';
import type { Pose2, SimSnapshot, Vec2 } from '../contracts/sim';
import {
  TRAILER_IDS,
  TRUCK_IDS,
  type TrailerAnchors,
  type TruckAnchors,
} from '../contracts/vehicle';
import { PREDICT_DISTANCE } from '../sim/constants';
import { predictTrailerRear } from '../sim/predict';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { createSceneRenderer } from './index';
import { mountPerfOverlay } from './perf-overlay';
import { computeViewports } from './viewports';

declare global {
  interface Window {
    __probe?: { stats: () => RenderStats };
  }
}

const RADIUS = 15;
const SPEED = 1.4;

type Fold = readonly [coupling: number, turntable: number];
const FOLDS = {
  left: [0.25, 0.2],
  right: [-0.25, -0.2],
  straight: [0, 0],
} as const satisfies Record<string, Fold>;

const advance = (p: { x: number; y: number }, heading: number, d: number) => ({
  x: p.x + Math.cos(heading) * d,
  y: p.y + Math.sin(heading) * d,
});

/** A snapshot on a circular path around `centre` with fixed pivot angles, geometrically consistent. */
function snapshotAt(
  seconds: number,
  centre: Vec2,
  truckAnchor: TruckAnchors,
  trailerAnchor: TrailerAnchors,
  [couplingAngle, turntableAngle]: Fold,
): SimSnapshot {
  const phase = (SPEED / RADIUS) * seconds;
  const truck: Pose2 = {
    x: centre.x + RADIUS * Math.cos(phase),
    y: centre.y + RADIUS * Math.sin(phase),
    heading: phase + Math.PI / 2,
  };
  const coupling = advance(truck, truck.heading, truckAnchor.coupling.x);
  const dollyHeading = truck.heading - couplingAngle;
  const dolly: Pose2 = {
    ...advance(coupling, dollyHeading, -trailerAnchor.eye.x),
    heading: dollyHeading,
  };
  const trailerHeading = dollyHeading - turntableAngle;
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
    couplingAngle,
    turntableAngle,
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

/** `?truck=<id>&trailer=<id>&fold=left|right|straight`; unknown values fall back to the defaults. */
function readOptions() {
  const query = new URLSearchParams(location.search);
  const truckId = TRUCK_IDS.find((id) => id === query.get('truck')) ?? TRUCK_IDS[0];
  const trailerId = TRAILER_IDS.find((id) => id === query.get('trailer')) ?? TRAILER_IDS[0];
  const key = query.get('fold');
  const fold: Fold = key === 'right' || key === 'straight' ? FOLDS[key] : FOLDS.left;
  return { truck: truckById(truckId), trailer: trailerById(trailerId), fold };
}

export function startProbe(root: HTMLElement): void {
  const { truck, trailer, fold } = readOptions();
  const truckAnchor = truckAnchors(truck);
  const trailerAnchor = trailerAnchors(trailer);

  const layout = resolveLayout(layouts.depot, exerciseById('slalom'));
  const centre: Vec2 = {
    x: (layout.yard.minX + layout.yard.maxX) / 2,
    y: (layout.yard.minY + layout.yard.maxY) / 2,
  };
  const params = resolveCombination(truck, trailer);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  root.append(canvas);

  const renderer = createSceneRenderer();
  renderer.init(canvas);
  renderer.setScene(layout, truck, trailer);

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
    const snapshot = snapshotAt(now / 1000, centre, truckAnchor, trailerAnchor, fold);
    const frame: RenderFrame = {
      snapshot,
      views: computeViewports(width, height, 'drive'),
      topDown: 'follow',
      aids: { pivots: true, path: true, tracks: true, ghost: true },
      predicted: predictTrailerRear(params, snapshot, 1, PREDICT_DISTANCE),
    };
    renderer.render(frame);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
