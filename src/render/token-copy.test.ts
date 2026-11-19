import { Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AIDS_LAYER, DEFAULT_LAYER, PERSPECTIVE_LAYER } from './seams';
import { tokenCopy } from './token-copy';

const layerMask = (o: Object3D): number => o.layers.mask;
const bit = (layer: number): number => 1 << layer;

describe('tokenCopy', () => {
  it('is on only when wanted, loaded and not disabled', () => {
    for (const wanted of [false, true]) {
      for (const loaded of [false, true]) {
        for (const disabled of [false, true]) {
          const token = new Object3D();
          const copy = new Object3D();
          const swap = tokenCopy([token]);
          swap.set(wanted);
          if (loaded) swap.setCopies([copy]);
          if (disabled) swap.disable();
          const on = wanted && loaded && !disabled;
          expect(layerMask(token), `${wanted}/${loaded}/${disabled}`).toBe(
            bit(on ? AIDS_LAYER : DEFAULT_LAYER),
          );
          if (loaded) expect(copy.visible).toBe(on);
          if (on) expect(layerMask(copy)).toBe(bit(PERSPECTIVE_LAYER));
        }
      }
    }
  });

  it('applies a copy that arrives after the flag was set', () => {
    const token = new Object3D();
    const copy = new Object3D();
    const swap = tokenCopy([token]);
    swap.set(true);
    expect(layerMask(token)).toBe(bit(DEFAULT_LAYER));
    swap.setCopies([copy]);
    expect(layerMask(token)).toBe(bit(AIDS_LAYER));
    expect(copy.visible).toBe(true);
  });

  it('reports only when the state changes', () => {
    const onApplied = vi.fn();
    const swap = tokenCopy([new Object3D()], onApplied);
    swap.set(false);
    swap.setCopies([new Object3D()]);
    expect(onApplied).not.toHaveBeenCalled();
    swap.set(true);
    swap.set(true);
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenLastCalledWith(true);
    swap.disable();
    swap.disable();
    expect(onApplied).toHaveBeenCalledTimes(2);
    expect(onApplied).toHaveBeenLastCalledWith(false);
  });
});
