import { describe, expect, it } from 'vitest';
import { KIT_FOOTPRINTS } from '../content/kit';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import { beltKitDecor } from './belt-kit';
import { chaseColliders } from './chase-camera';
import { kitStandInGeometry } from './kit-stand-ins';
import { YARD_KIT_DIMS } from './yard-kit-dims';
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

  it('keeps the chase eye out of the facade and the entrance canopy', () => {
    const colliders = chaseColliders(resolved);
    for (const piece of ['office-entrance', 'office-bay', 'hall-door-bay'] as const) {
      const placed = decor.filter((d) => d.piece === piece);
      expect(placed.length, piece).toBeGreaterThan(0);
      for (const d of placed) {
        const held = colliders.some(
          (c) =>
            c.height >= KIT_FOOTPRINTS[piece].height &&
            Math.abs(c.obb.cx - d.footprint.cx) < 1e-9 &&
            Math.abs(c.obb.cy - d.footprint.cy) < 1e-9 &&
            c.obb.halfWidth >= d.footprint.halfWidth,
        );
        expect(held, d.id).toBe(true);
      }
    }
  });

  it('leaves the skyline a box behind the facade and inside the roof slab', () => {
    for (const b of front) {
      const office = b.kind === 'office';
      const wall = KIT_FOOTPRINTS[office ? 'office-bay' : 'hall-wall-bay'].min[1];
      const slab = office ? YARD_KIT_DIMS.office.roofThickness : YARD_KIT_DIMS.hall.roofThickness;
      const inner = shell(b);
      expect((b.depth - inner.depth) / 2).toBeGreaterThan(-wall);
      expect(b.height - inner.height).toBeGreaterThan(0);
      expect(b.height - inner.height).toBeLessThan(slab);
    }
    for (const b of scenery.filter((o) => o.front !== true)) expect(shell(b)).toBe(b);
  });
});
