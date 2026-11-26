import { describe, expect, it } from 'vitest';
import { exerciseById } from '../../content/registry';
import { EXERCISE_IDS, type ExerciseId, type InputLog } from '../../contracts/exercise';
import type { LayoutId } from '../../contracts/layout';
import type { RunConfig } from '../drive';
import type { EntryRef } from './catalogue';
import { continueEntry, entryOfRun, lastEntryOf } from './continue';

const ex = (id: ExerciseId): EntryRef => ({ role: 'driver', kind: 'exercise', id });
const yard = (id: LayoutId): EntryRef => ({ role: 'driver', kind: 'yard', id });

const log = (layoutId: LayoutId, exerciseId: ExerciseId | null): InputLog => ({
  version: 3,
  layoutId,
  exerciseId,
  truckId: 'man-le-18-280',
  trailerId: 'krone-azw-18',
  lighting: 'day',
  mirrorsOnly: false,
  steps: 0,
  changes: [],
});

describe('continueEntry', () => {
  it('resumes the last entry until its exercise is done, then moves on', () => {
    expect(continueEntry(ex('reverse-bay'), [])).toEqual(ex('reverse-bay'));
    expect(continueEntry(ex('reverse-bay'), ['reverse-bay'])).toEqual(ex('reverse-corner'));
    expect(continueEntry(ex('reverse-bay'), ['reverse-bay', 'reverse-corner'])).toEqual(
      ex('dock-ramp'),
    );
  });

  it('searches forward and wraps past the end', () => {
    expect(continueEntry(ex('slalom'), ['slalom', 'straight-reverse'])).toEqual(ex('reverse-bay'));
    expect(continueEntry(ex('dock-ramp'), ['dock-ramp', 'slalom'])).toEqual(ex('straight-reverse'));
  });

  it('skips a done exercise only by looking forward, not back', () => {
    expect(continueEntry(ex('reverse-corner'), ['reverse-corner', 'dock-ramp'])).toEqual(
      ex('slalom'),
    );
  });

  it('keeps the last exercise when all are done', () => {
    expect(continueEntry(ex('dock-ramp'), [...EXERCISE_IDS])).toEqual(ex('dock-ramp'));
  });

  it('continues a free yard as that yard', () => {
    expect(continueEntry(yard('depot'), [])).toEqual(yard('depot'));
    expect(continueEntry(yard('depot'), [...EXERCISE_IDS])).toEqual(yard('depot'));
  });

  it('offers nothing without a last entry', () => {
    expect(continueEntry(null, [])).toBeNull();
  });

  it('follows a given curriculum order', () => {
    expect(continueEntry(ex('slalom'), ['slalom'], ['slalom', 'dock-ramp'])).toEqual(
      ex('dock-ramp'),
    );
  });
});

describe('lastEntryOf', () => {
  it('the last run stands in for a missing last entry', () => {
    expect(lastEntryOf(null, log('depot', 'reverse-bay'))).toEqual(ex('reverse-bay'));
    expect(lastEntryOf(null, log('logistics', null))).toEqual(yard('logistics'));
    expect(lastEntryOf(null, null)).toBeNull();
  });

  it('a stored last entry wins over the last run', () => {
    expect(lastEntryOf(ex('slalom'), log('depot', 'reverse-bay'))).toEqual(ex('slalom'));
    expect(lastEntryOf(yard('depot'), null)).toEqual(yard('depot'));
  });
});

describe('entryOfRun', () => {
  it('maps an exercise run and a yard run', () => {
    const base = { truckId: 'man-le-18-280', trailerId: 'krone-azw-18' } as const;
    const exercise = exerciseById('reverse-bay');
    const run: RunConfig = { ...base, layoutId: exercise.layout, exercise };
    expect(entryOfRun(run)).toEqual(ex('reverse-bay'));
    expect(entryOfRun({ ...base, layoutId: 'logistics', exercise: null })).toEqual(
      yard('logistics'),
    );
  });
});
