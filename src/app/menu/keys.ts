const STEP: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowUp: (i) => Math.max(i - 1, 0),
  ArrowDown: (i, last) => Math.min(i + 1, last),
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * Up, Down, Home and End move focus across the `selector` items inside `root` in document order and stop at the
 * ends; Tab is left alone. Returns the teardown.
 */
export function arrowFocus(root: HTMLElement, selector: string): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const step = STEP[e.key];
    if (step === undefined || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const items = [...root.querySelectorAll<HTMLElement>(selector)];
    const index = items.findIndex((item) => item === document.activeElement);
    if (index < 0) return;
    e.preventDefault();
    items[step(index, items.length - 1)]?.focus();
  };
  root.addEventListener('keydown', onKey);
  return () => {
    root.removeEventListener('keydown', onKey);
  };
}
