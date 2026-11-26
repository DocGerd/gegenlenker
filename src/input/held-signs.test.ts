import { describe, expect, it } from 'vitest';
import { createHeldSigns } from './held-signs';

describe('createHeldSigns', () => {
  it('shows the last pressed sign and falls back while an earlier key is held', () => {
    const held = createHeldSigns();
    expect(held.current()).toBeNull();
    held.press('Digit1', 'achtung');
    held.press('Digit2', 'halt');
    expect(held.current()).toBe('halt');
    held.release('Digit2');
    expect(held.current()).toBe('achtung');
    held.release('Digit1');
    expect(held.current()).toBeNull();
  });

  it('keeps the place of a source pressed again while held', () => {
    const held = createHeldSigns();
    held.press('Digit1', 'achtung');
    held.press('Digit2', 'halt');
    held.press('Digit1', 'achtung');
    expect(held.current()).toBe('halt');
  });

  it('reports whether a release let go of anything, and clears', () => {
    const held = createHeldSigns();
    held.press('mouse1', 'herkommen');
    expect(held.release('mouse2')).toBe(false);
    expect(held.release('mouse1')).toBe(true);
    held.press('Space', 'halt');
    held.clear();
    expect(held.current()).toBeNull();
  });
});
