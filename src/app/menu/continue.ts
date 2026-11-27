import { EXERCISE_IDS, type ExerciseId, type InputLog } from '../../contracts/exercise';
import type { EntryRef } from './catalogue';

const entryFrom = ({ role, layoutId, exerciseId }: InputLog): EntryRef =>
  exerciseId === null
    ? { role, kind: 'yard', id: layoutId }
    : { role, kind: 'exercise', id: exerciseId };

/**
 * What Continue starts: the last driven entry while its exercise is open, else the next open
 * exercise after it in curriculum order (wrapping), else the last one again. A yard stays, and so
 * does an Einweiser entry: his runs keep no bests, so `done` (the driver's) says nothing about him.
 */
export function continueEntry(
  last: EntryRef | null,
  done: readonly ExerciseId[],
  order: readonly ExerciseId[] = EXERCISE_IDS,
): EntryRef | null {
  if (last === null || last.kind === 'yard' || last.role === 'einweiser') return last;
  const from = order.indexOf(last.id);
  if (from < 0) return last;
  for (let step = 0; step < order.length; step++) {
    const id = order[(from + step) % order.length];
    if (id !== undefined && !done.includes(id)) return { role: last.role, kind: 'exercise', id };
  }
  return last;
}

/** The stored entry, else the one the last run was driven on. */
export function lastEntryOf(stored: EntryRef | null, log: InputLog | null): EntryRef | null {
  if (stored !== null || log === null) return stored;
  return entryFrom(log);
}
