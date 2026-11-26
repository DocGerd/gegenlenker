/** The nine vehicle hand signals of DGUV Vorschrift 70 Anhang 4, in its print order. */
export const SIGN_IDS = [
  'achtung',
  'halt',
  'haltGefahr',
  'abfahren',
  'herkommen',
  'entfernen',
  'links',
  'rechts',
  'abstand',
] as const;
export type SignId = (typeof SIGN_IDS)[number];

/** The Einweiser faults, each counted once per incident (`docs/einweiser-spike.md` §4). */
export const EINWEISER_FAULTS = [
  'inPath',
  'tooClose',
  'outOfSight',
  'signOutOfSight',
  'unclear',
  'lateHalt',
  'noAchtung',
] as const;
export type EinweiserFault = (typeof EINWEISER_FAULTS)[number];
