import type { ExerciseId } from '../contracts/exercise';
import type { MessageKey } from '../i18n/en';

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
