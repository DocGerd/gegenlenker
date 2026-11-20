import { describe, expect, it } from 'vitest';
import { isKitDecor, type Marking, type ResolvedLayout } from '../contracts/layout';
import type { Obb } from '../contracts/sim';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import { groundMask, MASK_MAX_SIZE, MASK_TEXEL, type GroundMask } from './ground-mask';

const MAX_REACH = 0.8;

const resolved = (id: keyof typeof layouts): ResolvedLayout => resolveLayout(layouts[id], null);

const distance = (obb: Obb, x: number, y: number): number => {
  const dx = x - obb.cx;
  const dy = y - obb.cy;
  const along = Math.abs(Math.cos(obb.heading) * dx + Math.sin(obb.heading) * dy) - obb.halfLength;
  const across = Math.abs(-Math.sin(obb.heading) * dx + Math.cos(obb.heading) * dy) - obb.halfWidth;
  return Math.hypot(Math.max(along, 0), Math.max(across, 0));
};

/** Texels (centre, value) of one channel that are not zero. */
function lit(mask: GroundMask, channel: 0 | 1): { x: number; y: number; value: number }[] {
  const out: { x: number; y: number; value: number }[] = [];
  for (let at = channel; at < mask.data.length; at += 2) {
    const value = mask.data[at] ?? 0;
    if (value === 0) continue;
    const texel = (at - channel) / 2;
    out.push({
      x: mask.origin.x + ((texel % mask.width) + 0.5) * mask.texel,
      y: mask.origin.y + (Math.floor(texel / mask.width) + 0.5) * mask.texel,
      value,
    });
  }
  return out;
}

const decals = (mask: GroundMask): Uint8Array => mask.data.filter((_, at) => at % 2 === 1);

describe.each(['depot', 'logistics'] as const)('ground mask of %s', (id) => {
  const layout = resolved(id);
  const mask = groundMask(layout);

  it('is deterministic and covers the layout bounds', () => {
    expect(groundMask(layout).data).toEqual(mask.data);
    expect(mask.texel).toBe(MASK_TEXEL);
    expect(mask.data).toHaveLength(mask.width * mask.height * 2);
    expect(mask.origin).toEqual({ x: layout.bounds.minX, y: layout.bounds.minY });
    expect(mask.width * mask.texel).toBeGreaterThanOrEqual(layout.bounds.maxX - layout.bounds.minX);
    expect(mask.height * mask.texel).toBeGreaterThanOrEqual(
      layout.bounds.maxY - layout.bounds.minY,
    );
  });

  it('darkens only within reach of a footprint, and does so at every obstacle', () => {
    const footprints = [
      ...layout.obstacles.map((o) => o.obb),
      ...layout.decor.filter((d) => !isKitDecor(d)).map((d) => d.footprint),
    ];
    const contact = lit(mask, 0);
    expect(contact.length).toBeGreaterThan(0);
    for (const { x, y } of contact) {
      expect(Math.min(...footprints.map((f) => distance(f, x, y)))).toBeLessThanOrEqual(
        MAX_REACH + mask.texel,
      );
    }
    for (const o of layout.obstacles) {
      const probe = { x: o.obb.cx, y: o.obb.cy };
      const i = Math.floor((probe.x - mask.origin.x) / mask.texel);
      const j = Math.floor((probe.y - mask.origin.y) / mask.texel);
      expect(mask.data[(j * mask.width + i) * 2]).toBeGreaterThan(0);
    }
  });

  it('puts decals on the yard and street only', () => {
    const roads = layout.surfaces.filter((s) => s.kind !== 'pavement').map((s) => s.rect);
    const marks = lit(mask, 1);
    expect(marks.length).toBeGreaterThan(0);
    for (const { x, y } of marks) {
      expect(roads.some((r) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY)).toBe(
        true,
      );
    }
  });

  it('never lets the exercise show in the decals', () => {
    for (const exercise of exercises.filter((e) => e.layout === id)) {
      expect(decals(groundMask(resolveLayout(layouts[id], exercise)))).toEqual(decals(mask));
    }
  });
});

describe('parked trailers', () => {
  it('draw no decals of their own, wherever an exercise parks them', () => {
    const layout = resolved('depot');
    const parked = (cx: number, cy: number): ResolvedLayout => ({
      ...layout,
      obstacles: [
        ...layout.obstacles,
        {
          id: 'x',
          kind: 'parked',
          obb: { cx, cy, halfLength: 8, halfWidth: 1.25, heading: 0 },
          height: 3.5,
        },
      ],
    });
    const base = decals(groundMask(layout));
    expect(decals(groundMask(parked(72, 20)))).toEqual(base);
    expect(decals(groundMask(parked(30, 50)))).toEqual(base);
    expect(decals(groundMask({ ...layout, props: [] }))).toEqual(base);
  });
});

describe('bays', () => {
  const layout = resolved('logistics');
  const bays = layout.markings.filter((m) => m.kind === 'bay');
  const mask = groundMask(layout);
  const reach = 4;

  const inkNear = (point: { x: number; y: number }, from: GroundMask): number =>
    lit(from, 1).filter(({ x, y }) => Math.hypot(x - point.x, y - point.y) < reach).length;

  it('wear a scuff at both ends of every bay line alike', () => {
    expect(bays.length).toBeGreaterThan(1);
    for (const bay of bays) {
      for (const end of [bay.from, bay.to]) expect(inkNear(end, mask)).toBeGreaterThan(0);
    }
  });

  it('are stamped by their geometry, not by their order or direction', () => {
    const shuffled: Marking[] = [...layout.markings]
      .reverse()
      .map((m) => (m.kind === 'bay' ? { ...m, from: m.to, to: m.from } : m));
    expect(decals(groundMask({ ...layout, markings: shuffled }))).toEqual(decals(mask));
  });
});

describe('mask size', () => {
  it('stays within the texture limit on a large layout', () => {
    const layout = resolved('depot');
    const big = groundMask({
      ...layout,
      bounds: { minX: 0, minY: 0, maxX: 10_000, maxY: 4_000 },
      obstacles: [],
      decor: [],
      props: [],
      markings: [],
      surfaces: [],
    });
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(MASK_MAX_SIZE);
    expect(big.data.some((v) => v > 0)).toBe(false);
  });
});
