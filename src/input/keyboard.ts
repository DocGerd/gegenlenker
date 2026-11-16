import type { Gear } from '../contracts/sim';
import { type InputState, clamp, stepLever } from './mapping';

export type Keyboard = { readonly brake: boolean; tick(dt: number): void; dispose(): void };

const GEARS: Record<string, Gear> = { Digit1: 'P', Digit2: 'R', Digit3: 'N', Digit4: 'D' };
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const FASTER = ['KeyW', 'ArrowUp'];
const SLOWER = ['KeyS', 'ArrowDown'];

const isFormField = (target: EventTarget | null): boolean =>
  target instanceof Element && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);

/** Steering keys act in `tick`, at `steerRate` per second; every other key acts on keydown. */
export function createKeyboard(state: InputState, steerRate: number): Keyboard {
  const held = new Set<string>();
  let brake = false;
  const abort = new AbortController();
  const { signal } = abort;

  const releaseAll = (): void => {
    held.clear();
    brake = false;
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (isFormField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const { code } = e;
      if (LEFT.includes(code) || RIGHT.includes(code)) held.add(code);
      else if (
        e.repeat &&
        (FASTER.includes(code) || SLOWER.includes(code) || code === 'Space' || GEARS[code])
      ) {
        // OS key-repeat must not step the lever again.
      } else if (FASTER.includes(code)) stepLever(state, 1);
      else if (SLOWER.includes(code)) stepLever(state, -1);
      else if (code === 'Space') {
        state.lever = 0;
        brake = true;
      } else if (GEARS[code]) state.gear = GEARS[code];
      else return;
      e.preventDefault();
    },
    { signal },
  );

  // Releases are never filtered, so a modifier pressed in between cannot leave a key held.
  window.addEventListener(
    'keyup',
    (e) => {
      if (held.delete(e.code)) e.preventDefault();
      else if (e.code === 'Space' && brake) {
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
      const left = LEFT.some((k) => held.has(k));
      const right = RIGHT.some((k) => held.has(k));
      if (left !== right) {
        state.steer = clamp(state.steer + (left ? 1 : -1) * steerRate * dt, -1, 1);
      }
    },
    dispose: () => abort.abort(),
  };
}
