import type { SignId } from '../contracts/einweiser';

/**
 * The signs whose key or mouse button is held, by `source` (a key code or a button): the last pressed
 * shows, and releasing it falls back to the one pressed before while that one is still held.
 */
export type HeldSigns = {
  /** A source already held keeps its place: a key's OS repeat does not reorder. */
  press(source: string, sign: SignId): void;
  /** False when `source` was not held. */
  release(source: string): boolean;
  clear(): void;
  /** Null: arms down. */
  current(): SignId | null;
};

export function createHeldSigns(): HeldSigns {
  let held: { readonly source: string; readonly sign: SignId }[] = [];
  return {
    press(source, sign) {
      if (held.some((h) => h.source === source)) return;
      held = [...held, { source, sign }];
    },
    release(source) {
      const next = held.filter((h) => h.source !== source);
      const was = next.length !== held.length;
      held = next;
      return was;
    },
    clear() {
      held = [];
    },
    current: () => held.at(-1)?.sign ?? null,
  };
}
