import type { SignId } from '../contracts/einweiser';
import type { EinweiserInput } from '../einweiser/track';
import { isFormField } from './keyboard';
import { actionFor, SIGN_OF, type Action } from './keymap';
import { createHeldSigns } from './held-signs';
import { createLook, type LookSettings } from './look';
import { createPointerLock, type PointerLock } from './pointer-lock';

/** By `MouseEvent.button`: under pointer lock the left button gives Herkommen and the right one Entfernen. */
const MOUSE_SIGNS: ReadonlyMap<number, SignId> = new Map([
  [0, 'herkommen'],
  [2, 'entfernen'],
]);

export type WalkInputOptions = {
  /** His facing at the start, radians in the sim plane. */
  readonly heading: number;
  /** Read per mouse move, so a changed setting applies at once. */
  readonly look: () => LookSettings;
};

export type WalkInput = {
  /** What he does now; read once per sim step. */
  sample(): EinweiserInput;
  /**
   * Listens on `surface` (which holds the pointer lock) and the window; register it before any other
   * listener that should not see the keys and clicks he uses. `onLockLost` follows every lock → unlock.
   * Returns the teardown, which also releases the lock.
   */
  attach(surface: HTMLElement, onLockLost: () => void): () => void;
  /** Lets go of every key and button and releases the lock, as the pause sheet opens. */
  pause(): void;
};

export function createWalkInput({ heading, look: settings }: WalkInputOptions): WalkInput {
  const look = createLook({ heading, pitch: 0 }, settings);
  const signs = createHeldSigns();
  /** Walk keys down, by code. */
  const walking = new Map<string, Action>();
  let lock: PointerLock | null = null;

  const releaseAll = (): void => {
    walking.clear();
    signs.clear();
  };
  const releaseButtons = (): void => {
    for (const button of MOUSE_SIGNS.keys()) signs.release(`mouse${button}`);
  };
  const has = (action: Action): boolean => [...walking.values()].includes(action);

  return {
    sample() {
      return {
        keys: {
          forward: has('walkForward'),
          back: has('walkBack'),
          left: has('walkLeft'),
          right: has('walkRight'),
          jog: has('jog'),
        },
        heading: look.heading(),
        pitch: look.pitch(),
        sign: signs.current(),
      };
    },
    attach(surface, onLockLost) {
      const abort = new AbortController();
      const { signal } = abort;
      const pointer = createPointerLock(surface, (locked) => {
        if (locked) {
          look.lock();
          return;
        }
        look.unlock();
        releaseButtons();
        onLockLost();
      });
      lock = pointer;

      window.addEventListener(
        'keydown',
        (e) => {
          if (isFormField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
          const walk = actionFor('walk', e);
          const sign = actionFor('sign', e);
          if (walk === undefined && sign === undefined) return;
          e.preventDefault();
          if (e.repeat) return;
          if (walk !== undefined) walking.set(e.code, walk);
          const shown = sign === undefined ? undefined : SIGN_OF[sign];
          if (shown !== undefined) signs.press(e.code, shown);
        },
        { signal },
      );
      // Releases are never filtered, so a modifier pressed in between cannot leave a key held.
      window.addEventListener(
        'keyup',
        (e) => {
          if (walking.delete(e.code) || signs.release(e.code)) e.preventDefault();
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

      // Registered before the view input's, which a click here must never reach: it would pan the pane,
      // and cancelling `pointerdown` suppresses the mouse events used below. The pointer events'
      // `buttons` also read 0 in the browser's own hover moves, so the buttons come from the mouse
      // events, which fire for each button.
      surface.addEventListener(
        'pointerdown',
        (e) => {
          if (e.pointerType !== 'mouse') return;
          e.stopImmediatePropagation();
          if (!pointer.locked) pointer.request();
        },
        { signal },
      );
      // The click that takes the lock arrives before the lock does, and shows no sign.
      surface.addEventListener(
        'mousedown',
        (e) => {
          const sign = MOUSE_SIGNS.get(e.button);
          if (pointer.locked && sign !== undefined) signs.press(`mouse${e.button}`, sign);
        },
        { signal },
      );
      surface.addEventListener('mouseup', (e) => signs.release(`mouse${e.button}`), { signal });
      surface.addEventListener('mousemove', (e) => look.move(e.movementX, e.movementY), { signal });
      surface.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

      return () => {
        abort.abort();
        releaseAll();
        pointer.dispose();
        lock = null;
      };
    },
    pause() {
      releaseAll();
      lock?.exit();
    },
  };
}
