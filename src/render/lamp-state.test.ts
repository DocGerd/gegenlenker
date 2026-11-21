import { describe, expect, it } from 'vitest';
import type { ControlVector } from '../contracts/sim';
import { DAY, FLASH_PERIOD, lampState, lensLevel } from './lamp-state';

const control: ControlVector = { steer: 0, lever: 0, brake: false, gear: 'D' };
const at = (time: number, change: Partial<ControlVector> = {}) => ({
  time,
  control: { ...control, ...change },
});

describe('lampState', () => {
  it('lights the reversing lamps in R only, and the stop lamps while braking, by day too', () => {
    for (const gear of ['P', 'N', 'D'] as const)
      expect(lampState(at(0, { gear })).levels.reversing).toBe(0);
    expect(lampState(at(0, { gear: 'R' })).levels.reversing).toBe(1);
    expect(lampState(at(0)).levels.stop).toBe(0);
    expect(lampState(at(0, { brake: true })).levels.stop).toBe(1);
  });

  it('keeps everything else dark by day', () => {
    const { levels } = lampState(at(1.3, { gear: 'R', brake: true }), DAY);
    const lit = Object.entries(levels).filter(([, level]) => level > 0);
    expect(lit.map(([fn]) => fn).sort()).toEqual(['reversing', 'stop']);
  });

  it('lights position lamps, markers and dipped beam at night, the fog lamp never', () => {
    const { levels } = lampState(at(0), { lights: true, hazard: false });
    for (const fn of [
      'dipped-beam',
      'front-position',
      'side-marker',
      'end-outline-rear',
      'rear-plate',
    ] as const) {
      expect(levels[fn]).toBe(1);
    }
    expect(levels['rear-position']).toBeGreaterThan(0);
    expect(levels['rear-fog']).toBe(0);
  });

  it('darkens the lights, markers and tail lamps with the lights off, leaving stop and reversing automatic', () => {
    const { levels } = lampState(at(0, { gear: 'R', brake: true }), {
      lights: false,
      hazard: false,
    });
    const lit = Object.entries(levels).filter(([, level]) => level > 0);
    expect(lit.map(([fn]) => fn).sort()).toEqual(['reversing', 'stop']);
  });

  it('lights the lenses by day with the lights on', () => {
    const { levels } = lampState(at(0), { lights: true, hazard: false });
    expect(levels['dipped-beam']).toBe(1);
    expect(levels['rear-position']).toBeGreaterThan(0);
  });

  it('lights the work floodlights in R with the lights on only', () => {
    const work = (gear: ControlVector['gear'], lights: boolean): number =>
      lampState(at(0, { gear }), { lights, hazard: false }).levels.work;
    expect(work('R', true)).toBe(1);
    expect(work('R', false)).toBe(0);
    for (const gear of ['P', 'N', 'D'] as const) expect(work(gear, true)).toBe(0);
  });

  it('flashes the hazards independently of the lights', () => {
    const { levels } = lampState(at(0.01), { lights: false, hazard: true });
    expect(levels['rear-indicator']).toBe(1);
    expect(levels['dipped-beam']).toBe(0);
  });

  it('flashes the hazards from sim time at 90 ± 30 a minute (R48 6.5.9), every indicator in phase', () => {
    expect(60 / FLASH_PERIOD).toBeGreaterThanOrEqual(60);
    expect(60 / FLASH_PERIOD).toBeLessThanOrEqual(120);
    const hazard = { lights: false, hazard: true };
    const on = lampState(at(FLASH_PERIOD * 3 + 0.01), hazard).levels;
    const off = lampState(at(FLASH_PERIOD * 3 + FLASH_PERIOD * 0.75), hazard).levels;
    for (const fn of ['front-indicator', 'side-indicator', 'rear-indicator'] as const) {
      expect([on[fn], off[fn]]).toEqual([1, 0]);
    }
  });

  it('shows the brightest function of a shared lens', () => {
    const night = lampState(at(0, { brake: true }), { lights: true, hazard: false });
    expect(lensLevel(night, ['rear-position', 'stop'])).toBe(1);
    expect(
      lensLevel(lampState(at(0), { lights: true, hazard: false }), ['rear-position', 'stop']),
    ).toBeLessThan(1);
  });

  it('flashes a side marker that carries an indicator with the hazards at night, and keeps the others steady', () => {
    const night = { lights: true, hazard: true };
    const on = lampState(at(0.01), night);
    const off = lampState(at(FLASH_PERIOD * 0.75), night);
    const combined = ['side-marker', 'side-indicator'] as const;
    expect([lensLevel(on, combined), lensLevel(off, combined)]).toEqual([1, 0]);
    expect([lensLevel(on, ['side-marker']), lensLevel(off, ['side-marker'])]).toEqual([1, 1]);
    expect(lensLevel(off, ['rear-position', 'stop'])).toBeGreaterThan(0);
    expect(lensLevel(lampState(at(0), { lights: true, hazard: false }), combined)).toBe(1);
  });
});
