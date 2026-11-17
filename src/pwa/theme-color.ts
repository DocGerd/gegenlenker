export function syncThemeColor(): void {
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-surface')
    .trim();
  if (color === '') return;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', color);
    meta.removeAttribute('media');
  }
}
