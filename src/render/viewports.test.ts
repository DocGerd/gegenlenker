import { describe, expect, it } from 'vitest';
import { computeViewports, controlsHeight } from './viewports';

describe('computeViewports mirrors', () => {
  const sizes: [number, number][] = [
    [768, 1024],
    [800, 1208],
    [800, 1280],
    [834, 1112],
    [1024, 1366],
    [1280, 800],
    [1024, 600],
    [2560, 1600],
  ];

  it.each(sizes)('stay inside the cockpit and above the controls at %i x %i', (w, h) => {
    const { cockpit, mirrorLeft, mirrorRight } = computeViewports(w, h, 'drive');
    if (cockpit === null || mirrorLeft === null || mirrorRight === null) {
      throw new Error('drive mode has mirrors');
    }
    for (const m of [mirrorLeft, mirrorRight]) {
      expect(m.y).toBeGreaterThanOrEqual(cockpit.y);
      expect(m.y + m.height).toBeLessThanOrEqual(h - controlsHeight(w, h));
      expect(m.height).toBeGreaterThanOrEqual(m.width);
    }
  });
});
