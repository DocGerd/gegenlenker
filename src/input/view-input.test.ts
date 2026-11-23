import { describe, expect, it } from 'vitest';
import { createPointerRouter } from './view-input';

describe('pointer router', () => {
  it('reads one finger in each of two panes as two drags, never a pinch', () => {
    const router = createPointerRouter<'a' | 'b'>();
    expect(router.down(1, 'a', { x: 10, y: 10 })).toBe(true);
    expect(router.down(2, 'b', { x: 10, y: 10 })).toBe(true);
    expect(router.move(1, { x: 15, y: 10 })).toEqual({
      pane: 'a',
      gesture: { kind: 'drag', dx: 5, dy: 0 },
    });
    expect(router.move(2, { x: 10, y: 4 })).toEqual({
      pane: 'b',
      gesture: { kind: 'drag', dx: 0, dy: -6 },
    });
  });

  it('reads two fingers in one pane as a pinch about the finger that stayed', () => {
    const router = createPointerRouter<'a'>();
    router.down(1, 'a', { x: 10, y: 10 });
    router.down(2, 'a', { x: 30, y: 10 });
    expect(router.move(2, { x: 50, y: 10 })?.gesture).toEqual({
      kind: 'pinch',
      from: [
        { x: 30, y: 10 },
        { x: 10, y: 10 },
      ],
      to: [
        { x: 50, y: 10 },
        { x: 10, y: 10 },
      ],
    });
  });

  it('takes two pointers per pane at most, and a pane frees up when one lifts', () => {
    const router = createPointerRouter<'a' | 'b'>();
    expect(router.down(1, 'a', { x: 0, y: 0 })).toBe(true);
    expect(router.down(2, 'a', { x: 0, y: 0 })).toBe(true);
    expect(router.down(3, 'a', { x: 0, y: 0 })).toBe(false);
    expect(router.down(3, 'b', { x: 0, y: 0 })).toBe(true);
    router.up(1);
    expect(router.down(4, 'a', { x: 0, y: 0 })).toBe(true);
    expect(router.move(1, { x: 1, y: 1 })).toBeNull();
  });
});
