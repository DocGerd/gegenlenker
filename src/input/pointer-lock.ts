export type PointerLock = {
  readonly locked: boolean;
  /** Needs a user gesture; a refusal leaves it unlocked. */
  request(): void;
  exit(): void;
  /** Stops reporting, then releases the lock. */
  dispose(): void;
};

/**
 * Locks the pointer to `el`. `onChange` follows the browser's own state (`pointerlockchange`), so Esc,
 * a blur or a tab switch report like an `exit`.
 */
export function createPointerLock(el: Element, onChange: (locked: boolean) => void): PointerLock {
  const isLocked = (): boolean => document.pointerLockElement === el;
  let reported = isLocked();
  const sync = (): void => {
    const now = isLocked();
    if (now === reported) return;
    reported = now;
    onChange(now);
  };
  document.addEventListener('pointerlockchange', sync);

  const attempt = (options: PointerLockOptions | undefined): void => {
    // A browser may return nothing instead of a promise, or throw at once.
    let result: unknown;
    try {
      result = el.requestPointerLock(options);
    } catch {
      return;
    }
    if (!(result instanceof Promise)) return;
    result.catch((error: unknown) => {
      // Chrome on Linux has no raw input: retry with the OS-adjusted movement. Any other refusal (a
      // recent Esc, no gesture) leaves it unlocked and the next click asks again.
      if (
        options !== undefined &&
        error instanceof DOMException &&
        error.name === 'NotSupportedError'
      )
        attempt(undefined);
    });
  };

  return {
    // Live, not `reported`: the browser sets the lock element a task before `pointerlockchange`, and a
    // click in between must count.
    get locked() {
      return isLocked();
    },
    request() {
      if (!isLocked()) attempt({ unadjustedMovement: true });
    },
    exit() {
      if (isLocked()) document.exitPointerLock();
    },
    dispose() {
      document.removeEventListener('pointerlockchange', sync);
      if (isLocked()) document.exitPointerLock();
    },
  };
}

/** A fine primary pointer and the Pointer Lock API: the Einweiser's mouse look needs both, so only then is the role offered. */
export const pointerLookAvailable = (): boolean =>
  matchMedia('(pointer: fine)').matches && 'requestPointerLock' in Element.prototype;
