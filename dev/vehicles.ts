import '../src/styles/fonts';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import type { RenderFrame, ViewMode } from '../src/contracts/render';
import type { Pose2, SimSnapshot } from '../src/contracts/sim';
import { TRAILER_IDS, TRUCK_IDS, type VehicleParams } from '../src/contracts/vehicle';
import { readScenePalette } from '../src/render/palette';
import { mountPerfOverlay } from '../src/render/perf-overlay';
import { placeholderLayout, placeholderParts } from '../src/render/placeholder';
import { createThreeSceneRenderer } from '../src/render/three-renderer';
import { proceduralTrailer, proceduralTruck } from '../src/render/vehicle-visual';
import { computeViewports } from '../src/render/viewports';
import { trailerById, truckById } from '../src/vehicles/registry';
import { resolveCombination } from '../src/vehicles/resolve';

const STEER_PERIOD = 11;
const COUPLING_PERIOD = 17;
const TURNTABLE_PERIOD = 23;

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('harness markup missing');

/**
 * `?truck=&trailer=` ids; `?t=<seconds>` freezes the sweep; `?pose=<steer>,<coupling>,<turntable>`
 * pins each to a fraction of its range (−1…1); `?view=replay` gives the top-down the whole page.
 */
const query = new URLSearchParams(location.search);
const truck = truckById(TRUCK_IDS.find((id) => id === query.get('truck')) ?? TRUCK_IDS[0]);
const trailer = trailerById(
  TRAILER_IDS.find((id) => id === query.get('trailer')) ?? TRAILER_IDS[0],
);
const fixedTime = query.has('t') ? Number(query.get('t')) : null;
const mode: ViewMode = query.get('view') === 'replay' ? 'replay' : 'drive';
const pinned = query
  .get('pose')
  ?.split(',')
  .map((v) => Math.max(-1, Math.min(1, Number(v))));
const params = resolveCombination(truck, trailer);

const sweep = (seconds: number, period: number): number =>
  Math.sin((2 * Math.PI * seconds) / period);
const step = (p: { x: number; y: number }, heading: number, distance: number) => ({
  x: p.x + Math.cos(heading) * distance,
  y: p.y + Math.sin(heading) * distance,
});

/** H = P₀ − c u(θ₀), P₁ = H − d u(θ₁), P₂ = P₁ − L₂ u(θ₂), θ₁ = θ₀ − coupling, θ₂ = θ₁ − turntable. */
function snapshotAt(seconds: number, v: VehicleParams): SimSnapshot {
  const steer = pinned?.[0] ?? sweep(seconds, STEER_PERIOD);
  const couplingAngle = v.couplingLimit * (pinned?.[1] ?? sweep(seconds, COUPLING_PERIOD));
  const turntableAngle = v.turntableLimit * (pinned?.[2] ?? sweep(seconds, TURNTABLE_PERIOD));
  const truckPose: Pose2 = { x: 15, y: 0, heading: Math.PI / 2 }; // inside the clear ring of the placeholder yard
  const coupling = step(truckPose, truckPose.heading, -v.couplingOffset);
  const dollyHeading = truckPose.heading - couplingAngle;
  const dolly: Pose2 = { ...step(coupling, dollyHeading, -v.drawbar), heading: dollyHeading };
  const trailerHeading = dollyHeading - turntableAngle;
  const trailerPose: Pose2 = {
    ...step(dolly, trailerHeading, -v.trailerWheelbase),
    heading: trailerHeading,
  };
  const control = { steer, lever: 0, brake: false, gear: 'N' } as const;
  return {
    step: Math.round(seconds * 60),
    time: seconds,
    truck: truckPose,
    coupling,
    dolly,
    trailer: trailerPose,
    trailerRear: step(trailerPose, trailerHeading, -v.trailerRearOverhang),
    couplingAngle,
    turntableAngle,
    steer,
    roadWheelAngle: v.maxRoadWheelAngle * steer,
    speed: 0,
    control,
    blocked: null,
    contacts: 0,
    jackknifes: 0,
    directionChanges: 0,
  };
}

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
stage.append(canvas);

const renderer = createThreeSceneRenderer({
  ...placeholderParts,
  truck: proceduralTruck,
  trailer: proceduralTrailer,
});
renderer.init(canvas);
renderer.setScene(placeholderLayout, truck, trailer, readScenePalette());

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

const frame = (now: number): void => {
  const renderFrame: RenderFrame = {
    snapshot: snapshotAt(fixedTime ?? now / 1000, params),
    views: computeViewports(width, height, mode),
    topDown: 'follow',
    aids: { pivots: false, path: false, tracks: false, ghost: false },
    predicted: [],
  };
  renderer.render(renderFrame);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
