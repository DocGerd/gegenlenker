import '../src/styles/fonts';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import type { BlockReason, SimSnapshot } from '../src/contracts/sim';
import { createHud } from '../src/hud/hud';
import { createControls } from '../src/input/controls';
import { setLanguage } from '../src/i18n/i18n';
import { computeViewports } from '../src/render/viewports';

// ?lang=de|en  ?theme=light|dark  ?mode=exercise|yard  ?view=drive|replay
// ?frac=0.6 freezes both pivot angles at that share of the limit (negative: right)
// ?blocked=contact|coupling|turntable freezes the toast
const params = new URLSearchParams(location.search);
setLanguage(params.get('lang') === 'en' ? 'en' : 'de');
if (params.get('theme')) document.documentElement.dataset['theme'] = params.get('theme') ?? '';

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('harness markup missing');

const rect = (id: string, cls: string): HTMLElement => {
  const el = document.createElement('div');
  el.id = id;
  el.className = `rect ${cls}`;
  stage.append(el);
  return el;
};
const topDownEl = rect('top-down', '');
const cockpitEl = rect('cockpit', '');
const mirrorEls = [rect('mirror-left', 'mirror'), rect('mirror-right', 'mirror')];

const COUPLING_LIMIT = (80 * Math.PI) / 180;
const TURNTABLE_LIMIT = (85 * Math.PI) / 180;

// The HUD mounts before the controls so the dashboard band paints beneath them.
const hud = createHud(stage, {
  couplingLimit: COUPLING_LIMIT,
  turntableLimit: TURNTABLE_LIMIT,
  mode: params.get('mode') === 'yard' ? 'yard' : 'exercise',
  aids: { pivots: true, path: true, tracks: false, ghost: false },
  topDown: 'follow',
});
const controls = createControls(stage, { lockToLockTurns: 5, steerRate: 0.6 });
hud.onAction((a) => console.info('hud action', JSON.stringify(a)));

const place = (el: HTMLElement, r: { x: number; y: number; width: number; height: number }) => {
  el.hidden = false;
  Object.assign(el.style, {
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
};
const relayout = (): void => {
  const views = computeViewports(
    stage.clientWidth,
    stage.clientHeight,
    params.get('view') === 'replay' ? 'replay' : 'drive',
  );
  place(topDownEl, views.topDown);
  cockpitEl.hidden = !views.cockpit;
  if (views.cockpit) place(cockpitEl, views.cockpit);
  [views.mirrorLeft, views.mirrorRight].forEach((r, i) => {
    const el = mirrorEls[i] as HTMLElement;
    el.hidden = !r;
    if (r) place(el, r);
  });
  hud.layout(views);
};
addEventListener('resize', relayout);
relayout();

const BLOCKS: (BlockReason | null)[] = [null, 'contact', 'coupling', 'turntable'];
const frozen = params.get('frac');
const frozenBlock = params.get('blocked') as BlockReason | null;
const triangle = (t: number): number => Math.abs((((t % 2) + 2) % 2) - 1) * 2 - 1;

const snapshot = (time: number): SimSnapshot => {
  const control = controls.control();
  const sweep = (period: number, phase: number): number => triangle(time / period + phase);
  const coupling =
    frozen !== null ? Number(frozen) * COUPLING_LIMIT : sweep(10, 0.5) * COUPLING_LIMIT;
  const turntable =
    frozen !== null ? Number(frozen) * TURNTABLE_LIMIT : sweep(13, 0) * TURNTABLE_LIMIT;
  const pose = { x: 0, y: 0, heading: 0 };
  const walking = control.gear === 'D' ? 1 : control.gear === 'R' ? -1 : 0;
  return {
    step: 0,
    time,
    truck: pose,
    coupling: pose,
    dolly: pose,
    trailer: pose,
    trailerRear: pose,
    couplingAngle: coupling,
    turntableAngle: turntable,
    steer: control.steer,
    roadWheelAngle: 0,
    speed: walking * control.lever * 1.5,
    control,
    blocked: frozenBlock ?? BLOCKS[Math.floor(time / 3) % BLOCKS.length] ?? null,
    contacts: Math.floor(time / 7),
    jackknifes: Math.floor(time / 11),
    directionChanges: Math.floor(time / 5),
  };
};

const start = performance.now();
let last = start;
const frame = (now: number): void => {
  controls.tick((now - last) / 1000);
  last = now;
  hud.update(snapshot((now - start) / 1000));
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
