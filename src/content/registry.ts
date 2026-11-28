import type { ExerciseDefinition, ExerciseId } from '../contracts/exercise';
import { EXERCISE_IDS } from '../contracts/exercise';
import type { Layout, LayoutId } from '../contracts/layout';
import { coupling } from './exercises/coupling';
import { dockRamp } from './exercises/dock-ramp';
import { reverseBay } from './exercises/reverse-bay';
import { reverseCorner } from './exercises/reverse-corner';
import { slalom } from './exercises/slalom';
import { straightReverse } from './exercises/straight-reverse';
import { depot } from './layouts/depot';
import { logistics } from './layouts/logistics';

export const layouts: Readonly<Record<LayoutId, Layout>> = { depot, logistics };

const byId: Readonly<Record<ExerciseId, ExerciseDefinition>> = {
  'straight-reverse': straightReverse,
  'reverse-bay': reverseBay,
  'reverse-corner': reverseCorner,
  coupling,
  'dock-ramp': dockRamp,
  slalom,
};

export const exercises: readonly ExerciseDefinition[] = EXERCISE_IDS.map((id) => byId[id]);

export function exerciseById(id: ExerciseId): ExerciseDefinition {
  return byId[id];
}
