import type { Pose2 } from './sim';
import type { MirrorId } from './vehicle';

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

/** His pose is sampled every this many steps (10 Hz, estimate) and held in between (`docs/einweiser-spike.md` §5). */
export const HOLD_STEPS = 6;

/** How the driver sees him: directly through the cab glass, and in which mirrors. */
export type Sight = { readonly direct: boolean; readonly mirrors: readonly MirrorId[] };

/** What the driver made of him in one step (`Reading` in `src/einweiser/signs.ts`). */
export type ReadingKind = 'none' | 'recognised' | 'unclear' | 'lost' | 'inPath';

/** His pose with the look pitch (radians, positive up). */
export type EinweiserPose = Pose2 & { readonly pitch: number };

/** Where the Einweiser is and what the driver makes of him, after a fixed step. */
export type EinweiserStatus = {
  /** As he walks and looks; only the first-person view follows it. */
  readonly live: EinweiserPose;
  /** What the driver, the sight check and the faults read (`docs/einweiser-spike.md` §5). */
  readonly held: Pose2;
  /** The sign shown; null: arms down. */
  readonly sign: SignId | null;
  /** Seconds since `sign` started showing, so a loop or a blend plays from its start. */
  readonly phase: number;
  readonly sight: Sight;
  /** The latest reading other than `none`, kept until the next one; `none` before the first. */
  readonly reading: ReadingKind;
};
