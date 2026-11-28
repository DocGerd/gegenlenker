import type { ExerciseId, Role } from '../contracts/exercise';
import type { LayoutId } from '../contracts/layout';
import type { MessageKey } from '../i18n/en';

export const LAYOUT_NAME: Readonly<Record<LayoutId, MessageKey>> = {
  depot: 'layoutDepot',
  logistics: 'layoutLogistics',
};

export const LAYOUT_BRIEF: Readonly<Record<Role, Readonly<Record<LayoutId, MessageKey>>>> = {
  driver: { depot: 'briefDepot', logistics: 'briefLogistics' },
  einweiser: { depot: 'guideBriefDepot', logistics: 'guideBriefLogistics' },
};

export const EXERCISE_TITLE: Readonly<Record<Role, Readonly<Record<ExerciseId, MessageKey>>>> = {
  driver: {
    'straight-reverse': 'exerciseStraightReverse',
    'reverse-bay': 'exerciseReverseBay',
    'reverse-corner': 'exerciseReverseCorner',
    coupling: 'exerciseCoupling',
    'dock-ramp': 'exerciseDockRamp',
    slalom: 'exerciseSlalom',
  },
  einweiser: {
    'straight-reverse': 'guideStraightReverse',
    'reverse-bay': 'guideReverseBay',
    'reverse-corner': 'guideReverseCorner',
    // driver only: the Einweiser catalogue leaves it out (`entries`)
    coupling: 'exerciseCoupling',
    'dock-ramp': 'guideDockRamp',
    slalom: 'guideSlalom',
  },
};

export const EXERCISE_BRIEF: Readonly<Record<Role, Readonly<Record<ExerciseId, MessageKey>>>> = {
  driver: {
    'straight-reverse': 'briefStraightReverse',
    'reverse-bay': 'briefReverseBay',
    'reverse-corner': 'briefReverseCorner',
    coupling: 'briefCoupling',
    'dock-ramp': 'briefDockRamp',
    slalom: 'briefSlalom',
  },
  einweiser: {
    'straight-reverse': 'guideBriefStraightReverse',
    'reverse-bay': 'guideBriefReverseBay',
    'reverse-corner': 'guideBriefReverseCorner',
    coupling: 'briefCoupling',
    'dock-ramp': 'guideBriefDockRamp',
    slalom: 'guideBriefSlalom',
  },
};
