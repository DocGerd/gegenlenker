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

  it('puts tokens and twins on the layers of every copies, twins and disabled state', () => {
    for (const wanted of [false, true]) {
      for (const loaded of [false, true]) {
        for (const topDown of [false, true]) {
          for (const withTwins of [false, true]) {
            for (const disabled of [false, true]) {
              const token = new Object3D();
              const copy = new Object3D();
              const twin = new Object3D();
              const swap = tokenCopy([token]);
              swap.set(wanted);
              swap.setTopDown(topDown);
              if (loaded) swap.setCopies([copy]);
              if (withTwins) swap.setTwins([twin]);
              if (disabled) swap.disable();
              const label = `${wanted}/${loaded}/${topDown}/${withTwins}/${disabled}`;
              const copies = wanted && loaded && !disabled;
              const twins = topDown && withTwins;
              expect(layerMask(token), label).toBe(
                copies
                  ? twins
                    ? 0
                    : bit(AIDS_LAYER)
                  : bit(twins ? PERSPECTIVE_LAYER : DEFAULT_LAYER),
              );
              if (withTwins) {
                expect(twin.visible, label).toBe(twins);
                expect(layerMask(twin), label).toBe(bit(AIDS_LAYER));
              }
              if (loaded) expect(copy.visible, label).toBe(copies);
            }
          }
        }
      }
    }
  });

  it('applies twins that arrive after the top-down flag was set', () => {
    const token = new Object3D();
    const twin = new Object3D();
    const swap = tokenCopy([token]);
    swap.setTopDown(true);
    expect(layerMask(token)).toBe(bit(DEFAULT_LAYER));
    swap.setTwins([twin]);
    expect(layerMask(token)).toBe(bit(PERSPECTIVE_LAYER));
    expect(twin.visible).toBe(true);
    swap.setTwins(null);
    expect(layerMask(token)).toBe(bit(DEFAULT_LAYER));
  });

  it('does not report twin changes as copy changes', () => {
    const onApplied = vi.fn();
    const swap = tokenCopy([new Object3D()], onApplied);
    swap.setTwins([new Object3D()]);
    swap.setTopDown(true);
    expect(onApplied).not.toHaveBeenCalled();
  });
});
