import { describe, expect, it } from 'vitest';
import { computeViewports, controlsHeight, MIN_MIRROR_HEIGHT } from './viewports';

describe('computeViewports mirrors', () => {
  it('stay inside the cockpit and above the controls at every size', () => {
    for (let w = 320; w <= 2000; w += 20) {
      for (let h = 320; h <= 2000; h += 20) {
        const { cockpit, mirrorLeft, mirrorRight } = computeViewports(w, h, 'drive');
        if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
          throw new Error('drive mode has mirrors');
        }
        for (const m of [mirrorLeft, mirrorRight]) {
          const at = `${w}x${h}`;
          expect(m.x, at).toBeGreaterThanOrEqual(cockpit.x);
          expect(m.x + m.width, at).toBeLessThanOrEqual(cockpit.x + cockpit.width);
          expect(m.y, at).toBeGreaterThanOrEqual(cockpit.y);
          expect(m.y + m.height, at).toBeLessThanOrEqual(cockpit.y + cockpit.height);
          expect(m.width, at).toBeGreaterThan(0);
          // With no room for the minimum height, the mirror keeps that size instead.
          if (m.height !== MIN_MIRROR_HEIGHT) {
            expect(m.y + m.height, at).toBeLessThanOrEqual(h - controlsHeight(w, h));
          }
        }
      }
    }
  });
});

describe('computeViewports key legend', () => {
  it('keeps the mirrors above a legend that reaches under them', () => {
    for (let w = 320; w <= 2000; w += 20) {
      for (let h = 320; h <= 2000; h += 20) {
        const { cockpit } = computeViewports(w, h, 'drive');
        if (cockpit === null) throw new Error('drive mode has a cockpit');
        for (const right of [cockpit.x + 300, cockpit.x + cockpit.width - 40]) {
          const legend = { right, height: 260 };
          // The legend starts right of the left mirror, so only the right one can sit over it.
          const { mirrorRight: m } = computeViewports(w, h, 'drive', legend);
          if (m === null) throw new Error('drive mode has mirrors');
          if (m.x < legend.right && m.height !== MIN_MIRROR_HEIGHT) {
            expect(m.y + m.height, `${w}x${h} legend to ${right}`).toBeLessThanOrEqual(
              h - legend.height,
            );
          }
        }
      }
    }
  });

  it('leaves the mirrors alone when the legend ends before them', () => {
    const base = computeViewports(1280, 720, 'drive');
    const legend = { right: (base.mirrorRight?.x ?? 0) - 1, height: 260 };
    expect(computeViewports(1280, 720, 'drive', legend)).toEqual(base);
  });
});
