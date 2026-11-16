import type { ControlVector, Gear } from '../contracts/sim';
import { applyMessages } from '../i18n/i18n';
import { createKeyboard } from './keyboard';
import './controls.css';
import { clamp, createInputState, stepLever, toControlVector } from './mapping';

export type Controls = { control(): ControlVector; tick(dt: number): void; dispose(): void };

const GEARS: readonly Gear[] = ['P', 'R', 'N', 'D'];
const DEAD_ZONE_PX = 8;

const MARKUP = `
<div class="ctl" data-ctl="root">
  <div class="ctl-pedals">
    <button type="button" class="ctl-stop" data-ctl="stop" data-i18n="stop"></button>
    <span class="ctl-label" data-i18n="speed"></span>
    <div class="ctl-lever" data-ctl="lever">
      <div class="ctl-rail"><div class="ctl-fill"></div><div class="ctl-thumb"></div></div>
    </div>
  </div>
  <div class="ctl-gears">
    <span class="ctl-label" data-i18n="gear"></span>
    <div data-ctl="gears">
      ${GEARS.map((g) => `<button type="button" class="ctl-gear" data-gear="${g}">${g}</button>`).join('')}
    </div>
  </div>
  <div class="ctl-steer">
    <span class="ctl-label" data-i18n="steer"></span>
    <div class="ctl-wheel" data-ctl="wheel">
      <svg viewBox="-50 -50 100 100" data-ctl="wheel-art">
        <circle class="ctl-rim" r="44" />
        <path class="ctl-spokes" d="M-44 0H44M0 0V44" />
        <circle class="ctl-hub" r="9" />
        <path class="ctl-mark" d="M0 -48V-38" />
      </svg>
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

const query = <T extends Element>(root: ParentNode, name: string): T => {
  const el = root.querySelector<T>(`[data-ctl="${name}"]`);
  if (!el) throw new Error(`controls markup lacks ${name}`);
  return el;
};

export function createControls(
  root: HTMLElement,
  opts: { lockToLockTurns: number; steerRate: number },
): Controls {
  const state = createInputState();
  const abort = new AbortController();
  const { signal } = abort;

  root.insertAdjacentHTML('beforeend', MARKUP);
  const container = query<HTMLElement>(root, 'root');
  applyMessages(container);
  container.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  const stop = query<HTMLElement>(container, 'stop');
  const lever = query<HTMLElement>(container, 'lever');
  const rail = lever.querySelector<HTMLElement>('.ctl-rail') as HTMLElement;
  const gears = query<HTMLElement>(container, 'gears');
  const wheel = query<HTMLElement>(container, 'wheel');
  const wheelArt = query<SVGElement>(container, 'wheel-art');
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
      state.steer = clamp(state.steer - delta / (Math.PI * opts.lockToLockTurns), -1, 1);
    }
    lastAngle = angle;
  };
  bindDrag(
    wheel,
    {
      down: (e) => {
        lastAngle = pointerAngle(e);
      },
      move: turnTo,
      end: () => {
        lastAngle = null;
      },
    },
    signal,
  );

  const gearButtons = [...gears.querySelectorAll<HTMLElement>('[data-gear]')];
  const render = (): void => {
    // steer > 0 is left, so the wheel turns counter-clockwise on screen.
    wheelArt.style.transform = `rotate(${-state.steer * opts.lockToLockTurns * 180}deg)`;
    lever.style.setProperty('--lever', String(state.lever));
    stop.toggleAttribute('data-active', state.brake);
    for (const b of gearButtons)
      b.setAttribute('aria-pressed', String(b.dataset['gear'] === state.gear));
  };
  render();

  return {
    control() {
      syncBrake();
      return toControlVector(state);
    },
    tick(dt) {
      keyboard.tick(dt);
      syncBrake();
      render();
    },
    dispose() {
      abort.abort();
      keyboard.dispose();
      container.remove();
    },
  };
}
