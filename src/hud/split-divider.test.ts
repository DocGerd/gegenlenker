import { describe, expect, it } from 'vitest';
import type { TopDownSplit } from '../contracts/render';
import { createSplitDivider, type SplitAction } from './split-divider';

class FakeElement extends EventTarget {
  hidden = false;
  disabled = false;
  title = '';
  clientWidth = 1000;
  clientHeight = 800;
  readonly attributes = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  blur(): void {
    this.dispatchEvent(new Event('blur'));
  }
}

const percents = (actions: SplitAction[]): number[] =>
  actions.flatMap((a) => (a.type === 'split' ? [Math.round(a.share * 100)] : []));

const split = (orientation: 'landscape' | 'portrait', share: number): TopDownSplit => ({
  orientation,
  share,
  min: 0.2,
  max: 0.6,
  fallback: 0.4,
});

function setup(initial: TopDownSplit) {
  const handle = new FakeElement();
  const actions: SplitAction[] = [];
  const divider = createSplitDivider(
    {
      root: new FakeElement() as unknown as HTMLElement,
      split: new FakeElement() as unknown as HTMLElement,
      handle: handle as unknown as HTMLElement,
      reset: new FakeElement() as unknown as HTMLButtonElement,
    },
    { emit: (a) => actions.push(a), signal: new AbortController().signal },
  );
  divider.set(initial, true);
  const press = (key: string, repeat = false, ctrlKey = false): Event => {
    const e = Object.assign(new Event('keydown', { cancelable: true }), {
      key,
      repeat,
      ctrlKey,
      metaKey: false,
      altKey: false,
    });
    handle.dispatchEvent(e);
    return e;
  };
  return { handle, actions, press, divider };
}

describe('split divider keys', () => {
  it('grows the top view with the arrow towards the cockpit, per orientation', () => {
    const land = setup(split('landscape', 0.4));
    land.press('ArrowLeft');
    land.press('ArrowRight');
    expect(percents(land.actions)).toEqual([42, 38]);

    const port = setup(split('portrait', 0.4));
    port.press('ArrowDown');
    port.press('ArrowUp');
    expect(percents(port.actions)).toEqual([42, 38]);
  });

  it('leaves the other axis to the steering and the lever', () => {
    const land = setup(split('landscape', 0.4));
    expect(land.press('ArrowUp').defaultPrevented).toBe(false);
    expect(land.press('ArrowDown').defaultPrevented).toBe(false);
    const port = setup(split('portrait', 0.4));
    expect(port.press('ArrowLeft').defaultPrevented).toBe(false);
    expect(land.actions).toEqual([]);
    expect(port.actions).toEqual([]);
  });

  it('jumps to the limits with Home and End and clamps steps to them', () => {
    const d = setup(split('landscape', 0.59));
    d.press('ArrowLeft');
    d.press('Home');
    d.press('End');
    expect(d.actions).toEqual([
      { type: 'split', orientation: 'landscape', share: 0.6, commit: true },
      { type: 'split', orientation: 'landscape', share: 0.2, commit: true },
      { type: 'split', orientation: 'landscape', share: 0.6, commit: true },
    ]);
  });

  it('stays quiet but consumes the key at a limit', () => {
    const d = setup(split('landscape', 0.6));
    expect(d.press('ArrowLeft').defaultPrevented).toBe(true);
    expect(d.actions).toEqual([]);
  });

  it('stores a burst on release: repeats only move, key-up or blur commits once', () => {
    const d = setup(split('landscape', 0.4));
    d.press('ArrowLeft');
    d.press('ArrowLeft', true);
    d.press('ArrowLeft', true);
    expect(d.actions.map((a) => a.type === 'split' && a.commit)).toEqual([true, false, false]);
    d.handle.dispatchEvent(new Event('keyup'));
    d.handle.dispatchEvent(new Event('blur'));
    expect(d.actions.at(-1)).toEqual({
      type: 'split',
      orientation: 'landscape',
      share: 0.4,
      commit: true,
    });
    expect(d.actions).toHaveLength(4);
  });

  it('ignores keys with a modifier', () => {
    const d = setup(split('landscape', 0.4));
    const e = d.press('ArrowLeft', false, true);
    expect(e.defaultPrevented).toBe(false);
    expect(d.actions).toEqual([]);
  });
});
