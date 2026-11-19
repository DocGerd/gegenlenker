import type { Object3D } from 'three';
import { AIDS_LAYER, DEFAULT_LAYER, PERSPECTIVE_LAYER } from './seams';

export interface TokenCopy {
  /** Supplies the perspective copies once they exist; `null` withdraws them. */
  setCopies(copies: readonly Object3D[] | null): void;
  set(wanted: boolean): void;
  /** Permanent: the tokens go back to every camera. */
  disable(): void;
}

/**
 * Swaps top-down tokens for perspective-only copies. On (wanted, copies present, not disabled):
 * tokens draw top-down only and the copies draw in perspective. Off: the tokens draw everywhere.
 * `onApplied` fires only when the on/off state changes.
 */
export function tokenCopy(
  tokens: readonly Object3D[],
  onApplied?: (on: boolean) => void,
): TokenCopy {
  let copies: readonly Object3D[] | null = null;
  let wanted = false;
  let disabled = false;
  let reported = false;
  const apply = (): void => {
    const on = wanted && copies !== null && !disabled;
    for (const token of tokens) token.layers.set(on ? AIDS_LAYER : DEFAULT_LAYER);
    for (const copy of copies ?? []) {
      if (on) copy.layers.set(PERSPECTIVE_LAYER);
      copy.visible = on;
    }
    if (on !== reported) {
      reported = on;
      onApplied?.(on);
    }
  };
  return {
    setCopies(next) {
      copies = next;
      apply();
    },
    set(next) {
      wanted = next;
      apply();
    },
    disable() {
      disabled = true;
      apply();
    },
  };
}
