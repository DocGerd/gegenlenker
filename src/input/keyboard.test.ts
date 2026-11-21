import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyboard, type Keyboard } from './keyboard';
import { LEVER_HOLD_DELAY, createInputState, type InputState } from './mapping';

class FakeElement {
  tagName = 'DIV';
  closest(): null {
    return null;
  }
}

type KeyInit = { code: string; repeat?: boolean; ctrlKey?: boolean; target?: unknown };

/** Dispatches a cancelable key event on the stubbed window; returns whether it was handled. */
function press(type: 'keydown' | 'keyup', init: KeyInit): boolean {
  const { target, ...rest } = init;
  const e = Object.assign(new Event(type, { cancelable: true }), {
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...rest,
  });
  if (target !== undefined) Object.defineProperty(e, 'target', { value: target });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
const down = (code: string, init: Omit<KeyInit, 'code'> = {}): boolean =>
  press('keydown', { code, ...init });
const up = (code: string): boolean => press('keyup', { code });

describe('keyboard', () => {
  let state: InputState;
  let keyboard: Keyboard;

  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('Element', FakeElement);
    state = createInputState();
    keyboard = createKeyboard(state, 1);
  });

  afterEach(() => {
    keyboard.dispose();
    vi.unstubAllGlobals();
  });

  it('steps the lever once per press and ignores OS key-repeat', () => {
    expect(down('KeyW')).toBe(true);
    const stepped = state.lever;
    expect(stepped).toBeGreaterThan(0);
    expect(down('KeyW', { repeat: true })).toBe(true);
    expect(state.lever).toBe(stepped);
    down('KeyS');
    expect(state.lever).toBeLessThan(stepped);
  });

  it('ramps a held lever key in its own direction', () => {
    down('KeyW');
    const raised = state.lever;
    keyboard.tick(LEVER_HOLD_DELAY + 1);
    expect(state.lever).toBeGreaterThan(raised);
    up('KeyW');
    down('KeyS');
    const lowered = state.lever;
    keyboard.tick(LEVER_HOLD_DELAY + 1);
    expect(state.lever).toBeLessThan(lowered);
  });

  it('brakes on Space, releases on keyup and ignores repeat', () => {
    down('KeyW');
    expect(down('Space')).toBe(true);
    expect(state.lever).toBe(0);
    expect(keyboard.brake).toBe(true);
    keyboard.tick(1);
    expect(state.lever).toBe(0);
    expect(up('Space')).toBe(true);
    expect(keyboard.brake).toBe(false);
  });

  it('shifts gear on a digit or numpad key, not on repeat', () => {
    down('Digit4');
    expect(state.gear).toBe('D');
    down('Numpad2');
    expect(state.gear).toBe('R');
    down('Digit3', { repeat: true });
    expect(state.gear).toBe('R');
  });

  it('toggles the lights on H and the hazard lights on X, not on repeat, and leaves the lever alone', () => {
    expect([state.lights, state.hazard]).toEqual([false, false]);
    expect(down('KeyH')).toBe(true);
    down('KeyH', { repeat: true });
    expect([state.lights, state.hazard]).toEqual([true, false]);
    down('KeyX');
    down('KeyH');
    expect([state.lights, state.hazard]).toEqual([false, true]);
    expect(state.lever).toBe(0);
  });

  it('keeps steering and resetting on key-repeat', () => {
    down('KeyC');
    expect(state.resetting).toBe(true);
    down('KeyC', { repeat: true });
    expect(state.resetting).toBe(true);
    down('ArrowLeft', { repeat: true });
    expect(state.resetting).toBe(false);
    keyboard.tick(0.5);
    expect(state.steer).toBeCloseTo(0.5);
  });

  it('cancels opposite steering keys and stops on release', () => {
    down('KeyA');
    down('KeyD');
    keyboard.tick(0.5);
    expect(state.steer).toBe(0);
    up('KeyA');
    keyboard.tick(0.25);
    expect(state.steer).toBeCloseTo(-0.25);
    up('KeyD');
    keyboard.tick(1);
    expect(state.steer).toBeCloseTo(-0.25);
  });

  it('ignores modified, unbound and form-field keys', () => {
    expect(down('KeyW', { ctrlKey: true })).toBe(false);
    expect(down('KeyQ')).toBe(false);
    const field = Object.assign(new FakeElement(), { tagName: 'INPUT' });
    expect(down('KeyW', { target: field })).toBe(false);
    expect(state.lever).toBe(0);
    expect(down('KeyW', { target: new FakeElement() })).toBe(true);
    expect(state.lever).toBeGreaterThan(0);
  });
});
