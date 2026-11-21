import type { Object3D } from 'three';
import { AIDS_LAYER, DEFAULT_LAYER, PERSPECTIVE_LAYER } from './seams';

export interface TokenCopy {
  /** Supplies the perspective copies once they exist; `null` withdraws them. */
  setCopies(copies: readonly Object3D[] | null): void;
  /** Supplies the night twins once they exist; `null` withdraws them. */
  setTwins(twins: readonly Object3D[] | null): void;
  set(wanted: boolean): void;
  /** Whether the top-down view draws the twins in place of the tokens. */
  setTopDown(on: boolean): void;
  /** Permanent: the copies stay off, so the perspective cameras draw the tokens. */
  disable(): void;
}

/** The layer a token draws on, or `null` when no camera draws it. */
export function tokenLayer(copiesOn: boolean, twinsOn: boolean): number | null {
  if (copiesOn) return twinsOn ? null : AIDS_LAYER;
  return twinsOn ? PERSPECTIVE_LAYER : DEFAULT_LAYER;
}

/** Puts `token` on the layer `tokenLayer` names. */
export function placeToken(token: Object3D, copiesOn: boolean, twinsOn: boolean): void {
  const layer = tokenLayer(copiesOn, twinsOn);
  if (layer === null) token.layers.disableAll();
  else token.layers.set(layer);
}

/**
 * Swaps top-down tokens for perspective-only copies. On (wanted, copies present, not disabled):
 * tokens draw top-down only and the copies draw in perspective. Off: the tokens draw everywhere.
 * With twins drawn, the top-down view takes them instead and the tokens leave it.
 * `onApplied` fires only when the on/off state of the copies changes.
 */
export function tokenCopy(
  tokens: readonly Object3D[],
  onApplied?: (on: boolean) => void,
): TokenCopy {
  let copies: readonly Object3D[] | null = null;
  let twins: readonly Object3D[] | null = null;
  let wanted = false;
  let topDown = false;
  let disabled = false;
  let reported = false;
  const apply = (): void => {
    const on = wanted && copies !== null && !disabled;
    const twinsOn = topDown && twins !== null;
    for (const token of tokens) placeToken(token, on, twinsOn);
    for (const copy of copies ?? []) {
      if (on) copy.layers.set(PERSPECTIVE_LAYER);
      copy.visible = on;
    }
    for (const twin of twins ?? []) {
      twin.layers.set(AIDS_LAYER);
      twin.visible = twinsOn;
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
    setTwins(next) {
      twins = next;
      apply();
    },
    set(next) {
      wanted = next;
      apply();
    },
    setTopDown(next) {
      topDown = next;
      apply();
    },
    disable() {
      disabled = true;
      apply();
    },
  };
}
