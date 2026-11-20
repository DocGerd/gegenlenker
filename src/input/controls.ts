import type { LampSwitches } from '../contracts/render';
import type { ControlVector, Gear } from '../contracts/sim';
import { applyMessages, t } from '../i18n/i18n';
import { createKeyboard } from './keyboard';
import './controls.css';
import {
  clamp,
  createInputState,
  POINTER_SWEEP_DEG,
  pointerAngleDeg,
  steerDisplay,
  stepLever,
  stepReset,
  stepSteer,
  toControlVector,
  turnTicks,
} from './mapping';

export type Controls = {
  control(): ControlVector;
  /** The lamp switches; a new object after each change, so a caller may compare by identity. */
  lamps(): LampSwitches;
  /** `actualSteer` is the snapshot's rate-limited steer; the centred cue waits for it. */
  tick(dt: number, actualSteer: number): void;
  dispose(): void;
};

const GEARS: readonly Gear[] = ['P', 'R', 'N', 'D'];
const DEAD_ZONE_PX = 8;

const ARC_RADIUS = 45.5;
const ARC_PATH = ((): string => {
  const rad = (POINTER_SWEEP_DEG * Math.PI) / 180;
  const x = (ARC_RADIUS * Math.sin(rad)).toFixed(2);
  const y = (-ARC_RADIUS * Math.cos(rad)).toFixed(2);
  return `M-${x} ${y}A${ARC_RADIUS} ${ARC_RADIUS} 0 0 1 ${x} ${y}`;
})();

const RESET_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7" /><path d="M12 2.5v5.5M12 13v.01" /></svg>';

const LIGHTS_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5.5C5.5 5.5 4 8.5 4 12s1.5 6.5 6 6.5c1.5 0 2.5-.5 3.5-1.5V7C12.5 6 11.5 5.5 10 5.5z" /><path d="M16.5 8.5H21M16.5 12H21M16.5 15.5H21" /></svg>';
const HAZARD_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5L21.5 20h-19z" /><path d="M12 9.5L16.5 17.5h-9z" /></svg>';

const markup = (lockToLockTurns: number): string => `
<div class="ctl" data-ctl="root">
  <div class="ctl-steer">
    <span class="ctl-label" data-i18n="steer"></span>
    <div class="ctl-wheel-box">
      <div class="ctl-wheel" data-ctl="wheel">
        <svg viewBox="-50 -50 100 100" data-ctl="wheel-art">
          <circle class="ctl-rim" r="29" />
          <path class="ctl-spokes" d="M-29 0H29M0 0V29" />
          <circle class="ctl-hub" r="7" />
          <path class="ctl-mark" d="M0 -35.5V-24" />
        </svg>
        <svg class="ctl-dial" viewBox="-50 -50 100 100" aria-hidden="true">
          <path class="ctl-arc" d="${ARC_PATH}" />
          ${turnTicks(lockToLockTurns)
            .map(
              (steer) =>
                `<path class="ctl-tick" d="M0 -42.5V-48.5" transform="rotate(${pointerAngleDeg(steer)})" />`,
            )
            .join('')}
          <path class="ctl-index" d="M-3.5 -41L3.5 -41L0 -36.5Z" />
          <g class="ctl-cue">
            <circle r="48" />
            <path d="M-9 -47L9 -47L0 -33Z" />
          </g>
          <g class="ctl-pointer" data-ctl="pointer"><circle cy="-45.5" r="4.2" /></g>
        </svg>
      </div>
      <button type="button" class="ctl-reset" data-ctl="reset">${RESET_ICON}</button>
    </div>
  </div>
  <div class="ctl-gears">
    <span class="ctl-label" data-i18n="gear"></span>
    <div data-ctl="gears">
      ${GEARS.map((g) => `<button type="button" class="ctl-gear" data-gear="${g}">${g}</button>`).join('')}
    </div>
    <div class="ctl-lamps">
      <button type="button" class="ctl-lamp" data-ctl="lights" aria-pressed="false">${LIGHTS_ICON}</button>
      <button type="button" class="ctl-lamp" data-ctl="hazard" aria-pressed="false">${HAZARD_ICON}</button>
    </div>
  </div>
  <div class="ctl-pedals">
    <button type="button" class="ctl-stop" data-ctl="stop" data-i18n="stop"></button>
    <span class="ctl-label" data-i18n="speed"></span>
    <div class="ctl-lever" data-ctl="lever">
      <div class="ctl-rail"><div class="ctl-fill"></div><div class="ctl-thumb"></div></div>
    </div>
  </div>
</div>`;

type DragHandlers = {
  down(e: PointerEvent): void;
  move(e: PointerEvent): void;
  end(): void;
};

/** One captured pointer per control, so a second thumb on another control never interferes. */
function bindDrag(el: HTMLElement, h: DragHandlers, signal: AbortSignal): void {
  let active: number | null = null;
  el.addEventListener(
    'pointerdown',
    (e) => {
      if (active !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      active = e.pointerId;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
      h.down(e);
    },
    { signal },
  );
  el.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerId === active) h.move(e);
    },
    { signal },
  );
  const release = (e: PointerEvent): void => {
    if (e.pointerId !== active) return;
    active = null;
    h.end();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    el.addEventListener(type, release, { signal });
  }
}

const query = <T extends Element>(
  root: ParentNode,
  name: string,
  type: abstract new () => T,
): T => {
  const el = root.querySelector(`[data-ctl="${name}"]`);
  if (!(el instanceof type)) throw new Error(`controls markup lacks ${name}`);
  return el;
};

export function createControls(
  root: HTMLElement,
  opts: { lockToLockTurns: number; steerRate: number; lights?: boolean },
): Controls {
  const state = createInputState(opts.lights ?? false);
  const abort = new AbortController();
  const { signal } = abort;

  root.insertAdjacentHTML('beforeend', markup(opts.lockToLockTurns));
  const container = query(root, 'root', HTMLElement);
  applyMessages(container);
  container.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  const stop = query(container, 'stop', HTMLElement);
  const lever = query(container, 'lever', HTMLElement);
  const rail = lever.querySelector<HTMLElement>('.ctl-rail') as HTMLElement;
  const gears = query(container, 'gears', HTMLElement);
  const wheel = query(container, 'wheel', HTMLElement);
  const wheelArt = query(container, 'wheel-art', SVGElement);
  const pointer = query(container, 'pointer', SVGElement);
  const reset = query(container, 'reset', HTMLElement);
  reset.title = t('resetSteer');
  reset.setAttribute('aria-label', t('resetSteer'));
  const lightsButton = query(container, 'lights', HTMLElement);
  const hazardButton = query(container, 'hazard', HTMLElement);
  for (const [button, key, label] of [
    [lightsButton, 'lights', t('lights')],
    [hazardButton, 'hazard', t('hazardLights')],
  ] as const) {
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener(
      'click',
      () => {
        state[key] = !state[key];
      },
      { signal },
    );
  }
  const keyboard = createKeyboard(state, opts.steerRate);

  // Two brake sources, so releasing one cannot release a Stop button a finger still holds.
  let pointerBrake = false;
  const syncBrake = (): void => {
    state.brake = pointerBrake || keyboard.brake;
  };
  bindDrag(
    stop,
    {
      down: () => {
        state.lever = 0;
        pointerBrake = true;
      },
      move: () => {},
      end: () => {
        pointerBrake = false;
      },
    },
    signal,
  );

  const setLeverFrom = (e: PointerEvent): void => {
    const r = rail.getBoundingClientRect();
    state.lever = clamp((r.bottom - e.clientY) / r.height, 0, 1);
  };
  bindDrag(lever, { down: setLeverFrom, move: setLeverFrom, end: () => {} }, signal);
  lever.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.deltaY !== 0) stepLever(state, e.deltaY < 0 ? 1 : -1);
    },
    { signal, passive: false },
  );

  for (const button of gears.querySelectorAll<HTMLElement>('[data-gear]')) {
    button.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        state.gear = button.dataset['gear'] as Gear;
      },
      { signal },
    );
  }

  let lastAngle: number | null = null;
  let wheelActive = false;
  const pointerAngle = (e: PointerEvent): number | null => {
    const r = wheel.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return Math.hypot(dx, dy) < DEAD_ZONE_PX ? null : Math.atan2(dy, dx);
  };
  const turnTo = (e: PointerEvent): void => {
    const angle = pointerAngle(e);
    if (angle === null) return;
    if (lastAngle !== null) {
      let delta = angle - lastAngle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      else if (delta <= -Math.PI) delta += 2 * Math.PI;
      state.resetting = false;
      state.steer = clamp(state.steer - delta / (Math.PI * opts.lockToLockTurns), -1, 1);
    }
    lastAngle = angle;
  };
  bindDrag(
    wheel,
    {
      down: (e) => {
        wheelActive = true;
        state.resetting = false;
        lastAngle = pointerAngle(e);
      },
      move: turnTo,
      end: () => {
        wheelActive = false;
        lastAngle = null;
      },
    },
    signal,
  );
  wheel.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.deltaY !== 0 && !wheelActive) stepSteer(state, e.deltaY < 0 ? 1 : -1);
    },
    { signal, passive: false },
  );
  reset.addEventListener(
    'click',
    () => {
      if (!wheelActive) state.resetting = true;
    },
    { signal },
  );

  const gearButtons = [...gears.querySelectorAll<HTMLElement>('[data-gear]')];
  // Last written values; render() compares these before touching the DOM.
  let shownRimTenths = NaN;
  let shownPointerTenths = NaN;
  let shownCentred = false;
  let shownLever = '';
  let shownBrake = false;
  let shownGear: Gear | null = null;
  let lamps: LampSwitches = { lights: state.lights, hazard: state.hazard };
  const syncLamps = (): void => {
    if (state.lights === lamps.lights && state.hazard === lamps.hazard) return;
    lamps = { lights: state.lights, hazard: state.hazard };
    lightsButton.setAttribute('aria-pressed', String(lamps.lights));
    hazardButton.setAttribute('aria-pressed', String(lamps.hazard));
  };
  const render = (actualSteer: number): void => {
    const d = steerDisplay(state.steer, actualSteer, opts.lockToLockTurns, shownCentred);
    const rimTenths = Math.round(d.rimRotationDeg * 10);
    if (rimTenths !== shownRimTenths) {
      shownRimTenths = rimTenths;
      wheelArt.style.transform = `rotate(${rimTenths / 10}deg)`;
    }
    const pointerTenths = Math.round(d.pointerAngle * 10);
    if (pointerTenths !== shownPointerTenths) {
      shownPointerTenths = pointerTenths;
      pointer.style.transform = `rotate(${pointerTenths / 10}deg)`;
    }
    if (d.centred !== shownCentred) {
      shownCentred = d.centred;
      wheel.toggleAttribute('data-centred', d.centred);
    }
    const leverValue = String(state.lever);
    if (leverValue !== shownLever) {
      shownLever = leverValue;
      lever.style.setProperty('--lever', leverValue);
    }
    if (state.brake !== shownBrake) {
      shownBrake = state.brake;
      stop.toggleAttribute('data-active', state.brake);
    }
    if (state.gear !== shownGear) {
      shownGear = state.gear;
      for (const b of gearButtons)
        b.setAttribute('aria-pressed', String(b.dataset['gear'] === state.gear));
    }
    syncLamps();
  };
  lightsButton.setAttribute('aria-pressed', String(lamps.lights));
  render(state.steer);

  return {
    control() {
      syncBrake();
      return toControlVector(state);
    },
    lamps() {
      syncLamps();
      return lamps;
    },
    tick(dt, actualSteer) {
      syncBrake();
      keyboard.tick(dt);
      stepReset(state, opts.steerRate, dt);
      render(actualSteer);
    },
    dispose() {
      abort.abort();
      keyboard.dispose();
      container.remove();
    },
  };
}
