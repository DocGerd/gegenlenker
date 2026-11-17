import { describe, expect, it } from 'vitest';
import type { Rect } from '../contracts/render';
import { clearRect, followFraming, leadTarget, targetArrow } from './follow-framing';

const pane: Rect = { x: 614, y: 0, width: 410, height: 600 };
const toolbar: Rect = { x: 630, y: 16, width: 256, height: 414 };
const pedals: Rect = { x: 940, y: 260, width: 84, height: 340 };

const inside = (p: { x: number; y: number }, r: Rect): boolean =>
  p.x >= r.x - 1e-6 &&
  p.x <= r.x + r.width + 1e-6 &&
  p.y >= r.y - 1e-6 &&
  p.y <= r.y + r.height + 1e-6;

describe('clearRect', () => {
  it('is the pane without chrome', () => {
    expect(clearRect(pane, [])).toEqual(pane);
  });

  it('avoids every chrome rect and prefers the roomiest region', () => {
    const clear = clearRect(pane, [toolbar, pedals]);
    for (const c of [toolbar, pedals]) {
      const hit =
        clear.x < c.x + c.width &&
        c.x < clear.x + clear.width &&
        clear.y < c.y + c.height &&
        c.y < clear.y + clear.height;
      expect(hit).toBe(false);
    }
    expect(clear.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
    expect(clear.height).toBeGreaterThan(100);
  });
});

describe('followFraming', () => {
  const clear = clearRect(pane, [toolbar, pedals]);
  const radius = 9;
  const vehicle = { x: 12, y: -7 };
  const input = { vehicle, radius, pane, clear, baseHalf: 20 };

  /** Screen position of a sim-plane point under the returned framing. */
  const toScreen = (p: { x: number; y: number }, f: ReturnType<typeof followFraming>) => {
    const scale = pane.height / (2 * f.half);
    return {
      x: pane.x + pane.width / 2 + (p.x - f.centre.x) * scale,
      y: pane.y + pane.height / 2 - (p.y - f.centre.y) * scale,
    };
  };

  it('keeps the vehicle ends inside the clear rect at every heading and lead', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const h = (deg * Math.PI) / 180;
      for (const dir of [-1, 0, 1]) {
        const lead = { x: dir * Math.cos(h), y: dir * Math.sin(h) };
        const f = followFraming({ ...input, lead });
        for (const sign of [-1, 1]) {
          const end = {
            x: vehicle.x + sign * radius * Math.cos(h),
            y: vehicle.y + sign * radius * Math.sin(h),
          };
          expect(inside(toScreen(end, f), clear), `${deg} deg, lead ${dir}`).toBe(true);
        }
      }
    }
  });

  it('shifts the vehicle away from the travel direction', () => {
    const roomy = { ...input, clear: pane };
    const east = toScreen(vehicle, followFraming({ ...roomy, lead: { x: 1, y: 0 } }));
    const north = toScreen(vehicle, followFraming({ ...roomy, lead: { x: 0, y: 1 } }));
    expect(east.x).toBeLessThan(pane.x + pane.width / 2);
    expect(north.y).toBeGreaterThan(pane.height / 2);
  });

  it('keeps the default scale where the vehicle already fits', () => {
    expect(followFraming({ ...input, clear: pane, lead: { x: 0, y: 0 } }).half).toBe(20);
  });
});

describe('leadTarget', () => {
  it('follows the signed speed, and the gear at standstill', () => {
    expect(leadTarget(0, 2, 'D')).toEqual({ x: 1, y: 0 });
    expect(leadTarget(0, -2, 'R').x).toBe(-1);
    expect(leadTarget(0, 0, 'R').x).toBe(-1);
    expect(leadTarget(0, 0, 'D').x).toBe(1);
    expect(leadTarget(0, 0, 'P')).toEqual({ x: 0, y: 0 });
  });
});

describe('targetArrow', () => {
  const clear: Rect = { x: 614, y: 200, width: 326, height: 400 };

  it('is absent while the target is inside the pane', () => {
    expect(targetArrow({ x: 700, y: 300 }, pane, clear, 20)).toBeNull();
  });

  it('sits on the clear rect edge, pointing at the target', () => {
    const arrow = targetArrow({ x: 100, y: 400 }, pane, clear, 20);
    expect(arrow).not.toBeNull();
    expect(arrow?.x).toBeCloseTo(clear.x + 20, 6);
    expect(Math.abs(arrow?.angle ?? 0)).toBeGreaterThan(Math.PI / 2);
  });
});
