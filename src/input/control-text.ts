import { t } from '../i18n/i18n';

export const NBSP = String.fromCharCode(0xa0);

/** Whole percent of full lock, signed: positive is left, like `ControlVector.steer`. */
export const steerPercent = (steer: number): number => Math.round(steer * 100) || 0;

export function steerValueText(steer: number): string {
  const pct = steerPercent(steer);
  if (pct === 0) return t('steerValueStraight');
  return `${Math.abs(pct)}${NBSP}%${NBSP}${t(pct > 0 ? 'steerValueLeft' : 'steerValueRight')}`;
}

/** Whole percent of the speed cap. */
export const leverPercent = (lever: number): number => Math.round(lever * 100);

export const leverValueText = (lever: number): string => `${leverPercent(lever)}${NBSP}%`;
