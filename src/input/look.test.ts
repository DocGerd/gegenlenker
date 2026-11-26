import { describe, expect, it } from 'vitest';
import { createLook, MAX_LOOK_DELTA_PX, PITCH_LIMIT, type LookSettings } from './look';

const DEG = Math.PI / 180;

function locked(settings: LookSettings = { degPerCount: 0.1, invert: false }, heading = 0) {
  const look = createLook({ heading, pitch: 0 }, () => settings);
  look.lock();
  look.move(0, 0); // the dropped first move
  return look;
}

describe('createLook', () => {
  it('turns right (a smaller heading) with the mouse to the right, and looks up with it moving up', () => {
    const look = locked();
    look.move(100, 0);
    expect(look.heading()).toBeCloseTo(-10 * DEG, 9);
    look.move(0, -100);
    expect(look.pitch()).toBeCloseTo(10 * DEG, 9);
  });

  it('inverts the vertical look only', () => {
    const look = locked({ degPerCount: 0.1, invert: true });
    look.move(100, -100);
    expect(look.heading()).toBeCloseTo(-10 * DEG, 9);
    expect(look.pitch()).toBeCloseTo(-10 * DEG, 9);
  });

  it('applies a changed setting at the next move', () => {
    let settings: LookSettings = { degPerCount: 0.1, invert: false };
    const look = createLook({ heading: 0, pitch: 0 }, () => settings);
    look.lock();
    look.move(0, 0);
    settings = { degPerCount: 0.2, invert: false };
    look.move(100, 0);
    expect(look.heading()).toBeCloseTo(-20 * DEG, 9);
  });

  it('clamps the pitch to 85 degrees and wraps the heading', () => {
    const look = locked({ degPerCount: 1, invert: false });
    for (let i = 0; i < 5; i++) look.move(0, -MAX_LOOK_DELTA_PX);
    expect(look.pitch()).toBe(PITCH_LIMIT);
    for (let i = 0; i < 10; i++) look.move(0, MAX_LOOK_DELTA_PX);
    expect(look.pitch()).toBe(-PITCH_LIMIT);
    const turned = locked({ degPerCount: 1, invert: false }, 170 * DEG);
    turned.move(-20, 0);
    expect(turned.heading()).toBeCloseTo(-170 * DEG, 9);
    expect(Math.abs(turned.heading())).toBeLessThanOrEqual(Math.PI);
  });

  it('drops the first move after a lock and clamps a single jump', () => {
    const look = createLook({ heading: 0, pitch: 0 }, () => ({ degPerCount: 0.1, invert: false }));
    look.lock();
    look.move(50, 50);
    expect([look.heading(), look.pitch()]).toEqual([0, 0]);
    look.move(5000, 0);
    expect(look.heading()).toBeCloseTo(-MAX_LOOK_DELTA_PX * 0.1 * DEG, 9);
    look.unlock();
    look.lock();
    const before = look.heading();
    look.move(50, 0);
    expect(look.heading()).toBe(before);
  });

  it('ignores moves while unlocked', () => {
    const look = createLook({ heading: 1, pitch: 0.2 }, () => ({
      degPerCount: 0.1,
      invert: false,
    }));
    look.move(100, 100);
    expect([look.heading(), look.pitch()]).toEqual([1, 0.2]);
  });
});
