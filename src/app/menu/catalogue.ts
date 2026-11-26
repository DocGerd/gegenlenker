import { exerciseById } from '../../content/registry';
import { EXERCISE_IDS, type ExerciseId } from '../../contracts/exercise';
import { LAYOUT_IDS, type LayoutId } from '../../contracts/layout';
import type { MessageKey } from '../../i18n/en';
import type { RunConfig } from '../drive';
import { EXERCISE_BRIEF, EXERCISE_TITLE, LAYOUT_BRIEF, LAYOUT_NAME } from '../entry-keys';
import type { Settings } from '../settings';
import type { OptionId } from './options';

/** On the catalogue entry, not the exercise, so a later role can reuse an exercise definition. */
export type Role = 'driver';
export type EntryKind = 'exercise' | 'yard';

export type EntryRef =
  | { readonly role: Role; readonly kind: 'exercise'; readonly id: ExerciseId }
  | { readonly role: Role; readonly kind: 'yard'; readonly id: LayoutId };

export type SetupStepId = 'conditions';

export type CatalogueEntry = {
  readonly ref: EntryRef;
  readonly title: MessageKey;
  readonly brief: MessageKey;
  readonly layout: LayoutId;
  readonly steps: readonly SetupStepId[];
};

export const SETUP_STEPS: Readonly<Record<SetupStepId, readonly OptionId[]>> = {
  conditions: ['truck', 'trailer', 'lighting', 'driveView'],
};

const DRIVER: readonly CatalogueEntry[] = [
  ...EXERCISE_IDS.map((id): CatalogueEntry => ({
    ref: { role: 'driver', kind: 'exercise', id },
    title: EXERCISE_TITLE[id],
    brief: EXERCISE_BRIEF[id],
    layout: exerciseById(id).layout,
    steps: ['conditions'],
  })),
  ...LAYOUT_IDS.map((id): CatalogueEntry => ({
    ref: { role: 'driver', kind: 'yard', id },
    title: LAYOUT_NAME[id],
    brief: LAYOUT_BRIEF[id],
    layout: id,
    steps: ['conditions'],
  })),
];

const BY_ROLE: Readonly<Record<Role, readonly CatalogueEntry[]>> = { driver: DRIVER };

export const CATALOGUE: readonly CatalogueEntry[] = Object.values(BY_ROLE).flat();

export const entryKey = (ref: EntryRef): string => `${ref.role}:${ref.kind}:${ref.id}`;

export function entriesOf(role: Role, kind: EntryKind): readonly CatalogueEntry[] {
  return BY_ROLE[role].filter((e) => e.ref.kind === kind);
}

export function entryOf(ref: EntryRef): CatalogueEntry {
  const key = entryKey(ref);
  const entry = CATALOGUE.find((e) => entryKey(e.ref) === key);
  if (entry === undefined) throw new Error(`Unknown catalogue entry ${key}`);
  return entry;
}

export function runConfigOf(ref: EntryRef, settings: Settings): RunConfig {
  const { truckId, trailerId } = settings;
  return ref.kind === 'exercise'
    ? { layoutId: entryOf(ref).layout, exercise: exerciseById(ref.id), truckId, trailerId }
    : { layoutId: ref.id, exercise: null, truckId, trailerId };
}
