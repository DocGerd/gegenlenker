import type { GoalCue } from '../scoring/score';
import { formatNumber, t } from '../i18n/i18n';

/**
 * The goal cue's two texts. `state` sits in the toast wrap's live region and changes only with the
 * verdict; `distance` is read aloud by no one (`aria-hidden`), since it changes every 0.1 m.
 */
export function goalCueTexts(cue: GoalCue): { state: string; distance: string } {
  if (cue.state === 'inside') return { state: t('goalInside'), distance: '' };
  if (cue.positionOk) return { state: t('goalPositionOk'), distance: '' };
  return {
    state: t(cue.angleOk ? 'goalAngleOk' : 'goalAngleOff'),
    distance: `${t('goalDistance').replace('{dist}', formatNumber(cue.distance, 1))} `,
  };
}
