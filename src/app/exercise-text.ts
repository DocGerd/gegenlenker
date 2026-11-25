import type { ExerciseId, InputLog } from '../contracts/exercise';
import type { LayoutId } from '../contracts/layout';
import { t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

export const LAYOUT_NAME: Readonly<Record<LayoutId, MessageKey>> = {
  depot: 'layoutDepot',
  logistics: 'layoutLogistics',
};

export const EXERCISE_TITLE: Readonly<Record<ExerciseId, MessageKey>> = {
  'straight-reverse': 'exerciseStraightReverse',
  'reverse-bay': 'exerciseReverseBay',
  'reverse-corner': 'exerciseReverseCorner',
  'dock-ramp': 'exerciseDockRamp',
  slalom: 'exerciseSlalom',
};

export const EXERCISE_BRIEF: Readonly<Record<ExerciseId, MessageKey>> = {
  'straight-reverse': 'briefStraightReverse',
  'reverse-bay': 'briefReverseBay',
  'reverse-corner': 'briefReverseCorner',
  'dock-ramp': 'briefDockRamp',
  slalom: 'briefSlalom',
};

/** What a stored run replays: the exercise, or the free yard it was driven in. */
export function replayContext(log: InputLog): string {
  return log.exerciseId === null
    ? `${t('freeYard')} · ${t(LAYOUT_NAME[log.layoutId])}`
    : t(EXERCISE_TITLE[log.exerciseId]);
}
