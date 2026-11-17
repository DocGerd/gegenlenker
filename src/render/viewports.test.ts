import { describe, expect, it } from 'vitest';
import { computeViewports, controlsHeight, legendHeight, MIN_MIRROR_HEIGHT } from './viewports';

describe('computeViewports mirrors', () => {
  it('stay inside the cockpit and above the controls and key legend at every size', () => {
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
            expect(m.y + m.height, at).toBeLessThanOrEqual(h - legendHeight(cockpit.height));
          }
        }
      }
    }
  });
});
