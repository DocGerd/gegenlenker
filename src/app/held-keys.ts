/**
 * A run ends while a brake key (Space, Enter) may still be held; its repeats and release must not click the focused
 * button. A code is free after its next fresh press or release. Returns the teardown.
 */
export function ignoreHeldBrakeKeys(target: EventTarget): () => void {
  const held = new Set(['Space', 'Enter', 'NumpadEnter']);
  const guard = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || !held.has(event.code)) return;
    if (event.type === 'keydown' && !event.repeat) {
      held.delete(event.code);
      return;
    }
    if (event.type === 'keyup') held.delete(event.code);
    event.preventDefault();
  };
  target.addEventListener('keydown', guard, true);
  target.addEventListener('keyup', guard, true);
  return () => {
    target.removeEventListener('keydown', guard, true);
    target.removeEventListener('keyup', guard, true);
  };
}
