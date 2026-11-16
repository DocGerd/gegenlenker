import { describe, expect, it } from 'vitest';
import { TrackHistory, WheelTrack } from './aids';

describe('WheelTrack', () => {
  it('adds a segment only after the spacing, starting at the previous sample', () => {
    const w = new WheelTrack(10, 0.25, 5);
    expect(w.sample(0, 0)).toBe(false);
    expect(w.sample(0.1, 0)).toBe(false);
    expect(w.sample(0.3, 0)).toBe(true);
    expect([w.slot, w.fromX, w.fromY, w.count]).toEqual([0, 0, 0, 1]);
    expect(w.sample(0.6, 0)).toBe(true);
    expect([w.slot, w.fromX, w.count]).toEqual([1, 0.3, 2]);
  });

  it('overwrites the oldest slot once the ring is full', () => {
    const w = new WheelTrack(3, 0.25, 5);
    w.sample(0, 0);
    const slots: number[] = [];
    for (let i = 1; i <= 5; i++) {
      expect(w.sample(i, 0)).toBe(true);
      slots.push(w.slot);
    }
    expect(slots).toEqual([0, 1, 2, 0, 1]);
    expect(w.count).toBe(3);
  });

  it('starts a new line after a jump instead of connecting across it', () => {
    const w = new WheelTrack(10, 0.25, 5);
    w.sample(0, 0);
    expect(w.sample(20, 0)).toBe(false);
    expect(w.count).toBe(0);
    expect(w.sample(20.5, 0)).toBe(true);
    expect(w.fromX).toBe(20);
  });
});

describe('TrackHistory', () => {
  it('clears every wheel when the step goes backwards, not when it repeats', () => {
    const h = new TrackHistory(2, 10, 0.25, 5);
    h.observe(10);
    for (const w of h.wheels) {
      w.sample(0, 0);
      w.sample(1, 0);
    }
    h.observe(10);
    expect(h.wheels.map((w) => w.count)).toEqual([1, 1]);
    h.observe(3);
    expect(h.wheels.map((w) => w.count)).toEqual([0, 0]);
    expect(h.wheels[0]?.sample(50, 50)).toBe(false);
    expect(h.wheels[0]?.sample(50.5, 50)).toBe(true);
  });
});
