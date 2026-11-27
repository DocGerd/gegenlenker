import { exerciseById } from '../../content/registry';
import { EXERCISE_IDS, ROLES, type ExerciseId, type Role } from '../../contracts/exercise';
import { LAYOUT_IDS, type LayoutId } from '../../contracts/layout';
import type { MessageKey } from '../../i18n/en';
import { t } from '../../i18n/i18n';
import { pointerLookAvailable } from '../../input/pointer-lock';
import type { RunConfig } from '../drive';
import { EXERCISE_BRIEF, EXERCISE_TITLE, LAYOUT_BRIEF, LAYOUT_NAME } from '../entry-keys';
import { runTrailer, type Settings } from '../settings';
import type { OptionId } from './options';

/** On the catalogue entry, not the exercise, so a later role can reuse an exercise definition. */
export type { Role };
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

const entries = (role: Role): readonly CatalogueEntry[] => [
  ...EXERCISE_IDS.map((id): CatalogueEntry => ({
    ref: { role, kind: 'exercise', id },
    title: EXERCISE_TITLE[role][id],
    brief: EXERCISE_BRIEF[role][id],
    layout: exerciseById(id).layout,
    steps: ['conditions'],
  })),
  ...LAYOUT_IDS.map((id): CatalogueEntry => ({
    ref: { role, kind: 'yard', id },
    title: LAYOUT_NAME[id],
    brief: LAYOUT_BRIEF[role][id],
    layout: id,
    steps: ['conditions'],
  })),
];

// No list shows the Einweiser entries: they are reached through the setup's role row.
const BY_ROLE: Readonly<Record<Role, readonly CatalogueEntry[]>> = {
  driver: entries('driver'),
  einweiser: entries('einweiser'),
};

export const CATALOGUE: readonly CatalogueEntry[] = Object.values(BY_ROLE).flat();

/** The Einweiser needs mouse look, so a device without it offers the driver only. */
export const offeredRoles = (): readonly Role[] => (pointerLookAvailable() ? ROLES : ['driver']);

/** The entry as this device can start it: a role it does not offer becomes the driver's. */
export const offeredEntry = (ref: EntryRef): EntryRef =>
  offeredRoles().includes(ref.role) ? ref : { ...ref, role: 'driver' };

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

/** An exercise's 1-based place in its role's curriculum. */
export function exerciseNumber(ref: EntryRef): number {
  const key = entryKey(ref);
  const index = entriesOf(ref.role, 'exercise').findIndex((e) => entryKey(e.ref) === key);
  if (index < 0) throw new Error(`${key} is not an exercise of its role`);
  return index + 1;
}

/** The entry's name as a heading or a line: an exercise numbered, a yard under Free yard. */
export function entryHeading(ref: EntryRef): string {
  const { title } = entryOf(ref);
  return ref.kind === 'yard'
    ? `${t('freeYard')} · ${t(title)}`
    : `${exerciseNumber(ref)} ${t(title)}`;
}

export function runConfigOf(ref: EntryRef, settings: Settings): RunConfig {
  const { truckId } = settings;
  const { role } = ref;
  const trailerId = runTrailer(settings, role);
  return ref.kind === 'exercise'
    ? { layoutId: entryOf(ref).layout, exercise: exerciseById(ref.id), truckId, trailerId, role }
    : { layoutId: ref.id, exercise: null, truckId, trailerId, role };
}
