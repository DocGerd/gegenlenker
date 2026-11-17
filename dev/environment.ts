import '../src/styles/fonts';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import { exercises, layouts } from '../src/content/registry';
import { resolveLayout } from '../src/content/resolve-layout';
import { LAYOUT_IDS } from '../src/contracts/layout';
import type { AidFlags, RenderFrame, TopDownMode } from '../src/contracts/render';
import type { Pose2, SimSnapshot, Vec2 } from '../src/contracts/sim';
import { createSceneRenderer } from '../src/render';
import { NO_PREDICTION } from '../src/sim/predict';
import { mountPerfOverlay } from '../src/render/perf-overlay';
import { computeViewports } from '../src/render/viewports';
import { trailerAnchors, truckAnchors } from '../src/vehicles/anchors';
import { trailerById, truckById } from '../src/vehicles/registry';

const AID_KEYS = ['pivots', 'path', 'tracks', 'ghost'] as const;
const FOLDS = { left: [0.25, 0.2], right: [-0.25, -0.2], straight: [0, 0] } as const;
const DRIVE_RADIUS = 15;
const DRIVE_SPEED = 2;
const PREDICT_STEP = 0.5;
const PREDICT_POINTS = 80;
const PREDICT_CURVATURE = 1 / 25;

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('harness markup missing');

/** `?layout=depot|logistics&exercise=<id>&topdown=follow|yard&aids=pivots,path,…|none&drive=1&fold=left|right|straight&pose=x,y,headingDeg` */
const query = new URLSearchParams(location.search);
const exercise = exercises.find((e) => e.id === query.get('exercise')) ?? null;
const layoutId = exercise?.layout ?? LAYOUT_IDS.find((id) => id === query.get('layout')) ?? 'depot';
const layoutDef = layouts[layoutId];
const resolved = resolveLayout(layoutDef, exercise);
const poseParam = query.get('pose')?.split(',').map(Number);
const start: Pose2 =
  poseParam?.length === 3 && poseParam.every(Number.isFinite)
    ? {
        x: poseParam[0] ?? 0,
        y: poseParam[1] ?? 0,
        heading: ((poseParam[2] ?? 0) * Math.PI) / 180,
      }
    : (exercise?.start ?? layoutDef.start);
const foldKey = query.get('fold');
const [couplingAngle, turntableAngle] =
  foldKey === 'right' || foldKey === 'straight' ? FOLDS[foldKey] : FOLDS.left;
const drive = query.get('drive') === '1';
let topDown: TopDownMode = query.get('topdown') === 'yard' ? 'yard' : 'follow';
const aidsParam = query.get('aids')?.split(',') ?? null;
const aidState: Record<(typeof AID_KEYS)[number], boolean> = {
  pivots: aidsParam === null || aidsParam.includes('pivots'),
  path: aidsParam === null || aidsParam.includes('path'),
  tracks: aidsParam === null || aidsParam.includes('tracks'),
  ghost: aidsParam === null || aidsParam.includes('ghost'),
};

const truck = truckById('man-le-18-280');
const trailer = trailerById('krone-azw-18');
const truckAnchor = truckAnchors(truck);
const trailerAnchor = trailerAnchors(trailer);

const advance = (p: Vec2, heading: number, d: number): Vec2 => ({
  x: p.x + Math.cos(heading) * d,
  y: p.y + Math.sin(heading) * d,
});

function snapshotAt(seconds: number): SimSnapshot {
  const phase = drive ? (DRIVE_SPEED / DRIVE_RADIUS) * seconds : 0;
  const heading = start.heading + phase;
  const centre = {
    x: start.x - Math.sin(start.heading) * DRIVE_RADIUS,
    y: start.y + Math.cos(start.heading) * DRIVE_RADIUS,
  };
  const pose: Pose2 = drive
    ? {
        x: centre.x + Math.sin(heading) * DRIVE_RADIUS,
        y: centre.y - Math.cos(heading) * DRIVE_RADIUS,
        heading,
      }
    : start;
  const coupling = advance(pose, pose.heading, truckAnchor.coupling.x);
  const dollyHeading = pose.heading - couplingAngle;
  const dolly: Pose2 = {
    ...advance(coupling, dollyHeading, -trailerAnchor.eye.x),
    heading: dollyHeading,
  };
  const trailerHeading = dollyHeading - turntableAngle;
  const trailerPose: Pose2 = {
    ...advance(dolly, trailerHeading, -trailerAnchor.turntable.x),
    heading: trailerHeading,
  };
  const control = { steer: 0, lever: 0, brake: false, gear: 'D' } as const;
  return {
    step: drive ? Math.round(seconds * 60) : 0,
    time: seconds,
    truck: pose,
    coupling,
    dolly,
    trailer: trailerPose,
    trailerRear: advance(trailerPose, trailerHeading, trailerAnchor.rearX),
    couplingAngle,
    turntableAngle,
    steer: 0,
    roadWheelAngle: 0,
    speed: drive ? DRIVE_SPEED : 0,
    control,
    blocked: null,
    contact: null,
    contacts: 0,
    jackknifes: 0,
    directionChanges: 0,
  };
}

/** A fixed arc backwards from the trailer rear. */
function predictedArc(from: SimSnapshot): Vec2[] {
  const out: Vec2[] = [];
  let heading = from.trailer.heading + Math.PI;
  let p = from.trailerRear;
  for (let i = 0; i < PREDICT_POINTS; i++) {
    out.push(p);
    heading -= PREDICT_CURVATURE * PREDICT_STEP;
    p = advance(p, heading, PREDICT_STEP);
  }
  return out;
}

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
stage.append(canvas);

const renderer = createSceneRenderer();
renderer.init(canvas);
renderer.setScene(resolved, truck, trailer);

let width = 0;
let height = 0;
const fit = (): void => {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.resize(width, height);
};
fit();
window.addEventListener('resize', fit);
mountPerfOverlay(stage, () => renderer.stats());

const panel = document.createElement('div');
panel.className = 'mono';
panel.style.cssText = [
  'position:fixed',
  'left:var(--space-2)',
  'bottom:var(--space-2)',
  'display:flex',
  'gap:var(--space-2)',
  'padding:var(--space-1) var(--space-2)',
  'background:var(--color-surface)',
  'color:var(--color-text)',
  'font-size:var(--text-sm)',
  'z-index:10',
].join(';');
for (const key of AID_KEYS) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = `aid-${key}`;
  box.checked = aidState[key];
  box.addEventListener('change', () => {
    aidState[key] = box.checked;
  });
  label.append(box, ` ${key}`);
  panel.append(label);
}
const mode = document.createElement('button');
mode.id = 'topdown-mode';
const showMode = (): void => {
  mode.textContent = topDown;
};
mode.addEventListener('click', () => {
  topDown = topDown === 'follow' ? 'yard' : 'follow';
  showMode();
});
showMode();
panel.append(mode);
stage.append(panel);

const tick = (now: number): void => {
  const snapshot = snapshotAt(now / 1000);
  const aids: AidFlags = { ...aidState };
  const frame: RenderFrame = {
    snapshot,
    views: computeViewports(width, height, 'drive'),
    topDown,
    aids,
    predicted: { ...NO_PREDICTION, trailer: predictedArc(snapshot) },
  };
  renderer.render(frame);
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
