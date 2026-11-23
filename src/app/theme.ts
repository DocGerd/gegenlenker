import { syncThemeColor } from '../pwa/theme-color';
import type { Settings } from './settings';

const DARK_QUERY = '(prefers-color-scheme: dark)';

let preference: Settings['theme'] = 'system';
let nightDrive = false;
let query: MediaQueryList | null = null;

/** An explicit Light or Dark wins; "system" follows the OS, except that a night drive is dark. */
export function resolveDark(pref: Settings['theme'], osDark: boolean, night: boolean): boolean {
  if (pref === 'system') return night || osDark;
  return pref === 'dark';
}

function sync(): void {
  const dark = resolveDark(preference, query?.matches === true, nightDrive);
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  // Native controls and scrollbars follow the chosen theme; "system" leaves both schemes to the browser, a night drive keeps them dark.
  const scheme = preference === 'system' ? (nightDrive ? 'dark' : 'light dark') : preference;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', scheme);
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

/** Marks the HUD and controls as sitting on a night drive; menu and results are not, so they follow the setting alone. */
export function setNightDrive(night: boolean): void {
  nightDrive = night;
  if (query !== null) sync();
}
