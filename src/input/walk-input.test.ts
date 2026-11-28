import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalkInput, type WalkInput } from './walk-input';

class FakeElement {
  tagName = 'DIV';
  closest(): null {
    return null;
  }
}

class FakeSurface extends EventTarget {
  getBoundingClientRect = () => ({ left: 0, top: 0 });
  requestPointerLock = vi.fn<(options?: unknown) => Promise<void>>(() => Promise.resolve());
}

type FakeDocument = EventTarget & {
  pointerLockElement: unknown;
  visibilityState: string;
  exitPointerLock: ReturnType<typeof vi.fn>;
};

const event = (type: string, init: Record<string, unknown> = {}): Event => {
  const { target, ...rest } = init;
  const e = Object.assign(new Event(type, { cancelable: true }), rest);
  if (target !== undefined) Object.defineProperty(e, 'target', { value: target });
  return e;
};

describe('walk input', () => {
  let surface: FakeSurface;
  let doc: FakeDocument;
  let win: EventTarget;
  let input: WalkInput;
  let changed: ReturnType<typeof vi.fn<(locked: boolean) => void>>;
  /** His view in the surface's px; the rest of the surface is the top view. */
  const VIEW = { x: 0, y: 0, width: 400, height: 300 };
  let detach: () => void;

  /** What the browser does once the pointer lock is granted or lost. */
  const setLock = (locked: boolean): void => {
    doc.pointerLockElement = locked ? surface : null;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  const key = (
    type: 'keydown' | 'keyup',
    code: string,
    init: Record<string, unknown> = {},
  ): boolean => {
    const e = event(type, { code, key: '', repeat: false, ...init });
    win.dispatchEvent(e);
    return e.defaultPrevented;
  };
  /** A mouse button goes down: `pointerdown` for the first one held, `mousedown` for each. */
  const press = (button: number, first = true, at = { clientX: 10, clientY: 10 }): Event => {
    if (first) surface.dispatchEvent(event('pointerdown', { pointerType: 'mouse', ...at }));
    const e = event('mousedown', { button });
    surface.dispatchEvent(e);
    return e;
  };
  const release = (button: number, last = true): void => {
    surface.dispatchEvent(event('mouseup', { button }));
    if (last) surface.dispatchEvent(event('pointerup', { pointerType: 'mouse' }));
  };
  const move = (movementX: number, movementY = 0): void => {
    surface.dispatchEvent(event('mousemove', { movementX, movementY }));
  };
  /** Takes the lock with a click, as a browser would. */
  const lock = (): void => {
    press(0);
    setLock(true);
    release(0);
    move(0, 0);
  };

  beforeEach(() => {
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), {
      pointerLockElement: null,
      visibilityState: 'visible',
      exitPointerLock: vi.fn(() => {
        setLock(false);
      }),
    });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('Element', FakeElement);
    surface = new FakeSurface();
    input = createWalkInput({ heading: 0, look: () => ({ degPerCount: 1, invert: false }) });
    changed = vi.fn<(locked: boolean) => void>();
    detach = input.attach(surface as unknown as HTMLElement, {
      view: () => VIEW,
      onLockChange: changed,
    });
  });

  afterEach(() => {
    detach();
    vi.unstubAllGlobals();
  });

  it('walks while a key is held, on WASD or the arrows, and jogs on Shift', () => {
    expect(input.sample().keys).toEqual({
      forward: false,
      back: false,
      left: false,
      right: false,
      jog: false,
    });
    expect(key('keydown', 'KeyW')).toBe(true);
    key('keydown', 'ArrowRight');
    key('keydown', 'ShiftLeft');
    expect(input.sample().keys).toMatchObject({ forward: true, right: true, jog: true });
    expect(key('keyup', 'KeyW')).toBe(true);
    key('keyup', 'ArrowRight');
    key('keyup', 'ShiftLeft');
    expect(input.sample().keys).toMatchObject({ forward: false, right: false, jog: false });
  });

  it('shows the last pressed sign key, Q and E and Space included, until released', () => {
    key('keydown', 'Digit5');
    expect(input.sample().sign).toBe('herkommen');
    key('keydown', 'KeyE');
    expect(input.sample().sign).toBe('rechts');
    key('keydown', 'Space');
    expect(input.sample().sign).toBe('halt');
    key('keyup', 'Space');
    expect(input.sample().sign).toBe('rechts');
    key('keyup', 'KeyE');
    key('keyup', 'Digit5');
    expect(input.sample().sign).toBeNull();
  });

  it('gives the steering signs on their keys in the steering mode', () => {
    detach();
    input = createWalkInput({
      heading: 0,
      look: () => ({ degPerCount: 1, invert: false }),
      mode: 'steering',
    });
    detach = input.attach(surface as unknown as HTMLElement, {
      view: () => VIEW,
      onLockChange: changed,
    });
    const shown = (code: string): unknown => {
      key('keydown', code);
      const sign = input.sample().sign;
      key('keyup', code);
      return sign;
    };
    expect(['KeyQ', 'Digit8', 'KeyX', 'Digit5'].map(shown)).toEqual([
      'lenkenLinks',
      'lenkenRechtsVoll',
      'lenkenGerade',
      'herkommen',
    ]);
  });

  it('leaves the keys of a form field, the pause sheet and a modifier alone, and always lets go', () => {
    const inDialog = Object.assign(new FakeElement(), { closest: () => ({}) });
    expect(key('keydown', 'KeyW', { target: inDialog })).toBe(false);
    expect(key('keydown', 'KeyW', { ctrlKey: true })).toBe(false);
    expect(input.sample().keys.forward).toBe(false);
    key('keydown', 'KeyW');
    // a modifier pressed in between must not hold the key
    key('keyup', 'KeyW', { ctrlKey: true });
    expect(input.sample().keys.forward).toBe(false);
  });

  it('lets go of every key on a blur and when the page is hidden', () => {
    key('keydown', 'KeyW');
    key('keydown', 'Digit1');
    win.dispatchEvent(new Event('blur'));
    expect(input.sample()).toMatchObject({ sign: null, keys: { forward: false } });
    key('keydown', 'Digit1');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(input.sample().sign).toBeNull();
  });

  it('takes the lock with a click that shows no sign, then signs with the buttons', () => {
    press(0);
    expect(surface.requestPointerLock).toHaveBeenCalledWith({ unadjustedMovement: true });
    setLock(true);
    release(0);
    expect(input.sample().sign).toBeNull();

    press(0);
    expect(input.sample().sign).toBe('herkommen');
    // a second button arrives as a mouse event only
    press(2, false);
    expect(input.sample().sign).toBe('entfernen');
    release(2, false);
    expect(input.sample().sign).toBe('herkommen');
    release(0);
    expect(input.sample().sign).toBeNull();
  });

  it("keeps a sign through the browser's own hover moves, which report no buttons", () => {
    lock();
    press(0);
    surface.dispatchEvent(event('pointermove', { pointerType: 'mouse', buttons: 0 }));
    expect(input.sample().sign).toBe('herkommen');
  });

  it('shows no sign for a click before the lock is granted, even if it is still held after', () => {
    press(2);
    setLock(true);
    expect(input.sample().sign).toBeNull();
    release(2);
    press(2);
    expect(input.sample().sign).toBe('entfernen');
  });

  it('signs with a click that lands after the browser grants the lock but before it reports it', () => {
    doc.pointerLockElement = surface;
    press(0);
    expect(input.sample().sign).toBe('herkommen');
  });

  it('keeps a click from reaching the view input, and suppresses the context menu', () => {
    const after = vi.fn();
    surface.addEventListener('pointerdown', after);
    press(0);
    expect(after).not.toHaveBeenCalled();
    const menu = event('contextmenu');
    surface.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('leaves a click outside his view to the view input, and takes one inside', () => {
    const after = vi.fn();
    surface.addEventListener('pointerdown', after);
    press(0, true, { clientX: 500, clientY: 10 });
    expect(after).toHaveBeenCalledTimes(1);
    expect(surface.requestPointerLock).not.toHaveBeenCalled();
    press(0, true, { clientX: 399, clientY: 299 });
    expect(after).toHaveBeenCalledTimes(1);
    expect(surface.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('keeps every click from the view input while locked, wherever the frozen pointer reads', () => {
    lock();
    const after = vi.fn();
    surface.addEventListener('pointerdown', after);
    press(0, true, { clientX: 500, clientY: 10 });
    expect(after).not.toHaveBeenCalled();
  });

  it('releases the lock on P, and does nothing unlocked', () => {
    expect(key('keydown', 'KeyP')).toBe(true);
    expect(doc.exitPointerLock).not.toHaveBeenCalled();
    lock();
    key('keydown', 'KeyP');
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it('turns with the mouse only while locked, after dropping the first move', () => {
    move(10);
    expect(input.sample().heading).toBe(0);
    lock();
    move(30);
    expect(input.sample().heading).toBeCloseTo((-30 * Math.PI) / 180, 9);
  });

  it('reports a lost lock once, lets go of the buttons and stops looking', () => {
    lock();
    press(0);
    expect(input.sample().sign).toBe('herkommen');
    setLock(false);
    expect(changed.mock.calls).toEqual([[true], [false]]);
    expect(input.sample().sign).toBeNull();
    const heading = input.sample().heading;
    move(40);
    expect(input.sample().heading).toBe(heading);
  });

  it('retries without the raw-input option where the browser lacks it', async () => {
    surface.requestPointerLock
      .mockRejectedValueOnce(new DOMException('', 'NotSupportedError'))
      .mockResolvedValue();
    press(0);
    await vi.waitFor(() => expect(surface.requestPointerLock).toHaveBeenCalledTimes(2));
    expect(surface.requestPointerLock).toHaveBeenLastCalledWith(undefined);
  });

  it('survives a browser that throws, returns nothing or refuses', async () => {
    surface.requestPointerLock.mockImplementationOnce(() => {
      throw new DOMException('', 'NotSupportedError');
    });
    expect(() => press(0)).not.toThrow();
    surface.requestPointerLock.mockImplementationOnce(() => undefined as unknown as Promise<void>);
    expect(() => press(0)).not.toThrow();
    surface.requestPointerLock.mockRejectedValueOnce(new DOMException('', 'SecurityError'));
    press(0);
    await Promise.resolve();
    expect(surface.requestPointerLock).toHaveBeenCalledTimes(3);
  });

  it('lets go of the keys and the lock when the pause sheet opens, and not again on a closed one', () => {
    lock();
    key('keydown', 'KeyW');
    input.pause();
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
    expect(input.sample().keys.forward).toBe(false);
    // the lock was lost by our own exit: the drive's guard sees the sheet already open
    expect(changed).toHaveBeenLastCalledWith(false);
    input.pause();
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
  });

  it('stops listening, then releases the lock, on teardown', () => {
    lock();
    changed.mockClear();
    detach();
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    key('keydown', 'KeyW');
    expect(input.sample().keys.forward).toBe(false);
  });
});
