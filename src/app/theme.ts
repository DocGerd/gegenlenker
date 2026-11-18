import { syncThemeColor } from '../pwa/theme-color';
import type { Settings } from './settings';

const DARK_QUERY = '(prefers-color-scheme: dark)';

let preference: Settings['theme'] = 'system';
let query: MediaQueryList | null = null;

function sync(): void {
  const dark = preference === 'dark' || (preference === 'system' && query?.matches === true);
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  // Native controls and scrollbars follow the chosen theme; "system" leaves both schemes to the browser.
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute('content', preference === 'system' ? 'light dark' : preference);
  syncThemeColor();
}

export function applyTheme(pref: Settings['theme']): void {
  preference = pref;
  if (query === null) {
    query = matchMedia(DARK_QUERY);
    query.addEventListener('change', sync);
  }
  sync();
}
