import { describe, expect, it } from 'vitest';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import type { Param } from '../contracts/vehicle';
import { trailerAnchors, truckAnchors } from './anchors';
import { trailerById, trailers, truckById, trucks } from './registry';
import { maxRoadWheelAngle, resolveCombination } from './resolve';
import { validatePair, validateTrailer, validateTruck } from './validate';

const man = truckById('man-le-18-280');
const arocs = truckById('arocs-1835-ak');
const krone = trailerById('krone-azw-18');
const hueffermann = trailerById('hueffermann-hpa-24-81-l');

const deg = (rad: number): number => (rad * 180) / Math.PI;

function params(node: unknown): Param[] {
  if (typeof node !== 'object' || node === null) return [];
  if ('value' in node && 'status' in node && 'source' in node) return [node as Param];
  return Object.values(node).flatMap(params);
}

describe('vehicle data', () => {
  it('gives every parameter a finite value and a source', () => {
    for (const spec of [...trucks, ...trailers]) {
      const all = params(spec);
      expect(all.length).toBeGreaterThan(0);
      for (const p of all) {
        expect(Number.isFinite(p.value)).toBe(true);
        if (p.status === 'sourced') expect(p.source).toMatch(/^https:\/\//);
        else expect(p.source.trim()).not.toBe('');
      }
    }
  });

  it('keeps sourced lengths consistent', () => {
    expect(arocs.frontOverhang.value + arocs.wheelbase.value + arocs.rearOverhang.value).toBe(
      arocs.length?.value,
    );
    expect(arocs.length?.value).toBe(6785);
    for (const [trailer, length] of [
      [krone, 9045],
      [hueffermann, 10420],
    ] as const) {
      expect(trailer.lengthToEye?.value).toBe(length);
      expect(trailer.drawbar.value + trailer.wheelbase.value + trailer.rearOverhang.value).toBe(
        length,
      );
    }
  });

  it('declares rear axle spacing exactly for multi-axle groups', () => {
    for (const r of trailers) {
      expect([1, 2]).toContain(r.rearAxleCount.value);
      expect(r.rearAxleSpacing !== undefined).toBe(r.rearAxleCount.value > 1);
    }
  });

  it('places the eye inside the cab and the mirrors outside the body', () => {
    for (const t of trucks) {
      expect(t.eye.leftOfCentre.value).toBeGreaterThan(0);
      expect(t.eye.leftOfCentre.value).toBeLessThan(t.width.value / 2);
      expect(t.eye.behindBumper.value).toBeLessThan(t.frontOverhang.value + t.wheelbase.value);
      expect(t.mirror.lateral.value).toBeGreaterThanOrEqual(t.width.value / 2);
    }
  });

  it('keeps pivot limits between 0 and 90 degrees', () => {
    for (const r of trailers) {
      for (const limit of [r.couplingLimit.value, r.turntableLimit.value]) {
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThan(90);
      }
    }
  });

  it('leaves clearance between truck rear and trailer front for every pair', () => {
    for (const t of trucks) {
      for (const r of trailers) {
        const clearance =
          t.couplingOffset.value + r.drawbar.value - r.frontOverhang.value - t.rearOverhang.value;
        expect(clearance).toBeGreaterThanOrEqual(500);
      }
    }
  });
});

describe('resolution', () => {
  it('calibrates full lock from the turning radius', () => {
    expect(deg(maxRoadWheelAngle(man))).toBeCloseTo(34.01, 1);
    expect(deg(maxRoadWheelAngle(arocs))).toBeCloseTo(32.46, 1);
  });

  it('resolves a combination to metres and radians', () => {
    const p = resolveCombination(man, krone);
    expect(p).toMatchObject({
      wheelbase: 3.9,
      couplingOffset: 1.25,
      drawbar: 2.2,
      trailerWheelbase: 5.17,
      truckFront: 5.22,
      truckRear: 1.1,
      trailerFrontOverhang: 0.6,
      trailerRearOverhang: 1.675,
      steerRate: 0.6,
    });
    expect(p.couplingLimit).toBeCloseTo((80 * Math.PI) / 180, 12);
    expect(p.turntableLimit).toBeCloseTo((85 * Math.PI) / 180, 12);
  });

  it('derives anchors from the data', () => {
    const eye = truckAnchors(man).eye;
    expect(eye.x).toBeCloseTo(4.22, 12);
    expect(eye.y).toBeCloseTo(0.4, 12);
    expect(eye.z).toBeCloseTo(1.95, 12);
    const mirrorRight = truckAnchors(man).mirrorRight;
    expect(mirrorRight.x).toBeCloseTo(4.62, 12);
    expect(mirrorRight.y).toBeCloseTo(-1.45, 12);
    expect(mirrorRight.z).toBeCloseTo(2.0, 12);
    const mirrorLeft = truckAnchors(arocs).mirrorLeft;
    expect(mirrorLeft.x).toBeCloseTo(4.65, 12);
    expect(mirrorLeft.y).toBeCloseTo(1.6, 12);
    expect(mirrorLeft.z).toBeCloseTo(2.2, 12);
    const axles = trailerAnchors(hueffermann).rearAxles.map((a) => a.x);
    expect(axles).toHaveLength(2);
    expect(axles[0]).toBeCloseTo(0.655, 12);
    expect(axles[1]).toBeCloseTo(-0.655, 12);
  });
});

describe('validation', () => {
  it('validates the registry', () => {
    for (const t of trucks) expect(validateTruck(t)).toEqual([]);
    for (const r of trailers) expect(validateTrailer(r)).toEqual([]);
    for (const t of trucks) for (const r of trailers) expect(validatePair(t, r)).toEqual([]);
    expect(trucks.map((t) => t.id)).toEqual([...TRUCK_IDS]);
    expect(trailers.map((r) => r.id)).toEqual([...TRAILER_IDS]);
  });

  it('reports broken rules', () => {
    const badTruck = {
      ...man,
      eye: { ...man.eye, leftOfCentre: { ...man.eye.leftOfCentre, value: 0 } },
    };
    expect(validateTruck(badTruck)).not.toEqual([]);
    const badTrailer = {
      ...krone,
      rearAxleSpacing: { value: 1310, status: 'estimate', source: 'x' } as const,
    };
    expect(validateTrailer(badTrailer)).not.toEqual([]);
    const tightTrailer = { ...krone, frontOverhang: { ...krone.frontOverhang, value: 2000 } };
    expect(validatePair(man, tightTrailer)).not.toEqual([]);
  });
});
