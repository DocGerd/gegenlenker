import { describe, expect, it } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import { beltKitDecor } from './belt-kit';
import { kitStandInGeometry } from './kit-stand-ins';
import { CLEARANCE, FRONT_BAY, REACH, sceneryBuildings, shell } from './skyline-layout';

const FACADES = new Set(['hall-wall-bay', 'hall-door-bay', 'office-bay', 'office-entrance']);

describe.each(Object.values(layouts))('the belt in the kit: $id', (layout) => {
  const resolved = resolveLayout(layout, null);
  const { bounds } = resolved;
  const scenery = sceneryBuildings(resolved);
  const front = scenery.filter((b) => b.front === true);
  const decor = beltKitDecor(scenery);

  it('builds sheds and offices of whole bays on the first row', () => {
    expect(front.some((b) => b.kind === 'hall' || b.kind === 'warehouse')).toBe(true);
    expect(front.some((b) => b.kind === 'office')).toBe(true);
    for (const b of front) {
      const bay = b.kind === 'office' ? FRONT_BAY.office : FRONT_BAY.hall;
      expect(b.length / bay).toBeCloseTo(Math.round(b.length / bay), 9);
      expect(b.roof).toBe('flat');
    }
  });

  it('turns every facade to the yard', () => {
    const facades = decor.filter((d) => FACADES.has(d.piece));
    expect(facades.length).toBeGreaterThan(0);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    for (const { footprint: f } of facades) {
      const towards = (cx - f.cx) * -Math.sin(f.heading) + (cy - f.cy) * Math.cos(f.heading);
      expect(towards).toBeGreaterThan(0);
    }
  });

  it('stays outside the bounds and inside the far plane', () => {
    const corners = [bounds.minX, bounds.maxX].flatMap((x) =>
      [bounds.minY, bounds.maxY].map((y): [number, number] => [x, y]),
    );
    for (const { footprint: f } of decor) {
      const reach = Math.hypot(f.halfLength, f.halfWidth);
      const dx = Math.max(bounds.minX - f.cx, 0, f.cx - bounds.maxX);
      const dy = Math.max(bounds.minY - f.cy, 0, f.cy - bounds.maxY);
      expect(Math.hypot(dx, dy) - reach).toBeGreaterThan(CLEARANCE / 2);
      for (const [x, y] of corners)
        expect(Math.hypot(f.cx - x, f.cy - y) + reach).toBeLessThan(REACH);
    }
  });

  it('is the same whatever exercise is set up and has a stand-in for the roofs', () => {
    for (const exercise of exercises.filter((e) => e.layout === layout.id)) {
      expect(beltKitDecor(sceneryBuildings(resolveLayout(layout, exercise))), exercise.id).toEqual(
        decor,
      );
    }
    expect(new Set(decor.map((d) => d.id)).size).toBe(decor.length);
    expect(kitStandInGeometry(decor)).not.toBeNull();
  });

  it('leaves the skyline a box inside each first-row building, below its roof', () => {
    for (const b of front) {
      const inner = shell(b);
      expect(inner.length).toBeLessThan(b.length);
      expect(inner.depth).toBeLessThan(b.depth);
      expect(inner.height).toBeLessThan(b.height);
    }
    for (const b of scenery.filter((o) => o.front !== true)) expect(shell(b)).toBe(b);
  });
});
