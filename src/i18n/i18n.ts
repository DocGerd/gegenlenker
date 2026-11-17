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

export function t(key: MessageKey): string {
  return catalogs[current][key];
}

const formats = new Map<string, Intl.NumberFormat>();

export function formatNumber(value: number, fractionDigits: number): string {
  const key = `${current}/${fractionDigits}`;
  let format = formats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(current, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formats.set(key, format);
  }
  return format.format(value);
}

export function applyMessages(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset['i18n'] as MessageKey);
  }
}
