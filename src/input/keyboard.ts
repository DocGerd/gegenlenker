import type { Gear } from '../contracts/sim';
import { actionFor, isAction, type Action } from './keymap';
import { type InputState, clamp, rampLever, rampTime, stepLever } from './mapping';

export type Keyboard = { readonly brake: boolean; tick(dt: number): void; dispose(): void };

const GEAR_OF: Partial<Record<Action, Gear>> = {
  gearP: 'P',
  gearR: 'R',
  gearN: 'N',
  gearD: 'D',
};

/** Keys typed into a form field or the pause dialog are not driving input. */
export const isFormField = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) ||
    target.closest('[role="dialog"]') !== null);

/**
 * Steering keys act in `tick`, at `steerRate` per second; lever keys step on keydown and ramp
 * in `tick` while held. Every other key acts on keydown.
 */
export function createKeyboard(state: InputState, steerRate: number): Keyboard {
  /** Steering keys down, by code. */
  const held = new Map<string, 'steerLeft' | 'steerRight'>();
  /** Lever keys down, by code, with their direction and seconds held. */
  const leverHeld = new Map<string, { dir: 1 | -1; heldFor: number }>();
  let brake = false;
  const abort = new AbortController();
  const { signal } = abort;

  const releaseAll = (): void => {
    held.clear();
    leverHeld.clear();
    brake = false;
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (isFormField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const action = actionFor('drive', e);
      if (action === undefined) return;
      const gear = GEAR_OF[action];
      const lever = action === 'faster' ? 1 : action === 'slower' ? -1 : 0;
      if (action === 'steerLeft' || action === 'steerRight') {
        held.set(e.code, action);
        state.resetting = false;
      } else if (action === 'resetSteer') state.resetting = true;
      else if (e.repeat) {
        // OS key-repeat must not step the lever again; the ramp runs in `tick`.
      } else if (lever !== 0) {
        stepLever(state, lever);
        leverHeld.set(e.code, { dir: lever, heldFor: 0 });
      } else if (action === 'brake') {
        state.lever = 0;
        leverHeld.clear();
        brake = true;
      } else if (action === 'lights') state.lights = !state.lights;
      else if (action === 'hazard') state.hazard = !state.hazard;
      else if (gear !== undefined) state.gear = gear;
      e.preventDefault();
    },
    { signal },
  );

  // Releases are never filtered, so a modifier pressed in between cannot leave a key held.
  window.addEventListener(
    'keyup',
    (e) => {
      if (held.delete(e.code) || leverHeld.delete(e.code)) e.preventDefault();
      else if (isAction('brake', e) && brake) {
        brake = false;
        e.preventDefault();
      }
    },
    { signal },
  );

  window.addEventListener('blur', releaseAll, { signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') releaseAll();
    },
    { signal },
  );

  return {
    get brake() {
      return brake;
    },
    tick(dt) {
      // A brake from any source cancels the ramp, as Space does.
      if (state.brake) leverHeld.clear();
      for (const [code, { dir, heldFor }] of leverHeld) {
        rampLever(state, dir, rampTime(heldFor, dt));
        leverHeld.set(code, { dir, heldFor: heldFor + dt });
      }
      const pressed = [...held.values()];
      const left = pressed.includes('steerLeft');
      const right = pressed.includes('steerRight');
      if (left !== right) {
        state.resetting = false;
        state.steer = clamp(state.steer + (left ? 1 : -1) * steerRate * dt, -1, 1);
      }
    },
    dispose: () => abort.abort(),
  };
}
