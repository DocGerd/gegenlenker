import type { Settings } from './settings';

const DARK_QUERY = '(prefers-color-scheme: dark)';

let preference: Settings['theme'] = 'system';
let query: MediaQueryList | null = null;

function sync(): void {
  const dark = preference === 'dark' || (preference === 'system' && query?.matches === true);
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
}

export function applyTheme(pref: Settings['theme']): void {
  preference = pref;
  if (query === null) {
    query = matchMedia(DARK_QUERY);
    query.addEventListener('change', sync);
  }
  sync();
}
