import { describe, expect, it } from 'vitest';
import { sightCue } from './sight-cue';

describe('sightCue', () => {
  it('names direct sight before any mirror, and class II before class IV', () => {
    expect(sightCue({ direct: true, mirrors: ['mirrorLeft'] }, false)).toBe('direct');
    expect(sightCue({ direct: false, mirrors: ['wideRight', 'mirrorRight'] }, false)).toBe(
      'mirrorRight',
    );
    expect(sightCue({ direct: false, mirrors: ['front', 'close'] }, false)).toBe('close');
  });

  it('says out of sight with no path, and unclear over any sight', () => {
    expect(sightCue({ direct: false, mirrors: [] }, false)).toBe('none');
    expect(sightCue({ direct: true, mirrors: [] }, true)).toBe('unclear');
    expect(sightCue({ direct: false, mirrors: ['close'] }, true)).toBe('unclear');
    expect(sightCue({ direct: false, mirrors: [] }, true)).toBe('none');
  });
});
