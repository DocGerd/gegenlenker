import type { Pose2 } from './sim';
import type { MirrorId } from './vehicle';

/**
 * The nine vehicle hand signals of DGUV Vorschrift 70 Anhang 4, in its print order, then the steering
 * signs (`lenken*`, not in V70): the wheel a little or to full lock toward his own side, or straight.
 */
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
  'lenkenLinks',
  'lenkenLinksVoll',
  'lenkenGerade',
  'lenkenRechts',
  'lenkenRechtsVoll',
] as const;
export type SignId = (typeof SIGN_IDS)[number];

/** How he signals a turn: where the tail goes (Links/Rechts fahren) or how the driver steers (#572). */
export const SIGNALLING_MODES = ['tail', 'steering'] as const;
export type SignallingMode = (typeof SIGNALLING_MODES)[number];
export const DEFAULT_SIGNALLING: SignallingMode = 'tail';

/** The signs each mode offers, in its sign bar's order. */
export const MODE_SIGNS: Readonly<Record<SignallingMode, readonly SignId[]>> = {
  tail: SIGN_IDS.slice(0, 9),
  steering: [
    'achtung',
    'halt',
    'haltGefahr',
    'abfahren',
    'herkommen',
    'entfernen',
    'lenkenLinksVoll',
    'lenkenRechtsVoll',
    'abstand',
    'lenkenLinks',
    'lenkenRechts',
    'lenkenGerade',
  ],
};

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

/** The first-person field of view choices (degrees, horizontal at 16:9; `docs/einweiser-spike.md` §3.2). */
export const FOV_CHOICES = [70, 80, 90, 100, 110] as const;
export type Fov = (typeof FOV_CHOICES)[number];
export const DEFAULT_FOV: Fov = 90;

/** Look speed per mouse count, in degrees (estimates; `docs/einweiser-spike.md` §3.1). */
export const MOUSE_SENSITIVITIES = ['low', 'medium', 'high'] as const;
export type MouseSensitivity = (typeof MOUSE_SENSITIVITIES)[number];
export const DEG_PER_COUNT: Readonly<Record<MouseSensitivity, number>> = {
  low: 0.025,
  medium: 0.05,
  high: 0.1,
};

/** An Einweiser run's own scoring, beside the driver measures of `RunResult`. */
export type EinweiserResult = {
  /** The vehicle hit him: the run ended at once, not reached. */
  readonly runOver: boolean;
  readonly faults: Readonly<Record<EinweiserFault, number>>;
  /** He walked backwards while the vehicle moved: an advisory note, not a fault. */
  readonly walkedBackwards: boolean;
};
