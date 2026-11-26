import { EXERCISE_IDS, type ExerciseId, type InputLog } from '../../contracts/exercise';
import type { RunConfig } from '../drive';
import type { EntryRef } from './catalogue';

/**
 * What Continue starts: the last driven entry while its exercise is open, else the next open
 * exercise after it in curriculum order (wrapping), else the last one again. A yard stays.
 */
export function continueEntry(
  last: EntryRef | null,
  done: readonly ExerciseId[],
  order: readonly ExerciseId[] = EXERCISE_IDS,
): EntryRef | null {
  if (last === null || last.kind === 'yard') return last;
  const from = order.indexOf(last.id);
  for (let step = 0; step < order.length; step++) {
    const id = order[(from + step) % order.length];
    if (id !== undefined && !done.includes(id)) return { role: last.role, kind: 'exercise', id };
  }
  return last;
}

/** The stored entry, else the one the last run was driven on. */
export function lastEntryOf(stored: EntryRef | null, log: InputLog | null): EntryRef | null {
  if (stored !== null || log === null) return stored;
  return log.exerciseId === null
    ? { role: 'driver', kind: 'yard', id: log.layoutId }
    : { role: 'driver', kind: 'exercise', id: log.exerciseId };
}

export const entryOfRun = (run: RunConfig): EntryRef =>
  run.exercise === null
    ? { role: 'driver', kind: 'yard', id: run.layoutId }
    : { role: 'driver', kind: 'exercise', id: run.exercise.id };
