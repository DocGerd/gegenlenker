import { de } from './de';
import { en, type MessageKey } from './en';

export type Lang = 'de' | 'en';

const catalogs: Record<Lang, Record<MessageKey, string>> = { de, en };

let current: Lang = 'de';

export function detectLanguage(preferred: readonly string[]): Lang {
  return preferred.some((p) => p.toLowerCase().startsWith('de')) ? 'de' : 'en';
}

export function setLanguage(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
}

export function language(): Lang {
  return current;
}

export function t(key: MessageKey): string {
  return catalogs[current][key];
}

export function formatNumber(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat(current, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function applyMessages(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset['i18n'] as MessageKey);
  }
}
