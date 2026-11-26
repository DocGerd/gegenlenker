/**
 * The second click of a double click lands on whatever the first one put under the pointer; drop it, so a double
 * click moves one level. Returns the teardown.
 */
export function ignoreMultiClicks(target: EventTarget): () => void {
  const guard = (event: Event): void => {
    if (!(event instanceof MouseEvent) || event.detail <= 1) return;
    event.preventDefault();
    event.stopPropagation();
  };
  target.addEventListener('click', guard, true);
  return () => {
    target.removeEventListener('click', guard, true);
  };
}
