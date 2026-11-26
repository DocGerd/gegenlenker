import {
  EINWEISER_FAULTS,
  type EinweiserFault,
  type EinweiserResult,
  type SignId,
} from '../contracts/einweiser';
import type { EinweiserTrack } from '../contracts/exercise';
import type { ContactQuery, Pose2, SimSnapshot } from '../contracts/sim';
import { clearance, lateHalt, runOver, signOutOfSight, walkedBackwards } from '../einweiser/faults';
import type { Occluder, SightGeometry } from '../einweiser/sight';
import {
  createReader,
  inPath,
  MOVEMENT_SIGNS,
  perceive,
  type Reading,
  TOO_CLOSE,
} from '../einweiser/signs';
import { createTrackCursor } from '../einweiser/track';
import { CONTACT_WARN_DISTANCE, DT } from '../sim/constants';
import { contactAhead, predictCombination } from '../sim/predict';
import { STOPPED_SPEED } from './score';

/** One sim step of an Einweiser run, as the live run and its replay both see it. */
export type EinweiserFacts = {
  /** The snapshot the driver read him at. */
  readonly before: SimSnapshot;
  /** After `sim.step`: its contacts and its end. */
  readonly after: SimSnapshot;
  readonly held: Pose2;
  /** The run-over margin (`EinweiserStep.moved`). */
  readonly moved: number;
  readonly sign: SignId | null;
  readonly inSight: boolean;
  readonly reading: Reading;
};

export type EinweiserTracker = {
  /** Once per sim step, in order. */
  update(f: EinweiserFacts): void;
  /** The vehicle hit him: the run ends at once. */
  runOver(): boolean;
  /** The latest reading the driver acted on was a recognised Halt: only then does a stop in the target end the run. */
  halted(): boolean;
  result(): EinweiserResult;
};

/** The Einweiser faults (`docs/einweiser-spike.md` §4), each counted once per incident. */
export function createEinweiserTracker(g: SightGeometry, contacts: ContactQuery): EinweiserTracker {
  const faults = Object.fromEntries(EINWEISER_FAULTS.map((f) => [f, 0])) as Record<
    EinweiserFault,
    number
  >;
  const active = new Set<EinweiserFault>();
  const flag = (kind: EinweiserFault, on: boolean): void => {
    if (on && !active.has(kind)) faults[kind] += 1;
    if (on) active.add(kind);
    else active.delete(kind);
  };
  let over = false;
  let halted = false;
  let achtung = false;
  let backwards = false;
  let previousSign: SignId | null = null;
  let previousHeld: Pose2 | null = null;
  let warnedFor = 0;

  return {
    update({ before: s, after, held, moved, sign, inSight, reading }) {
      const moving = Math.abs(s.speed) > STOPPED_SPEED;
      if (moving && runOver(g.params, s, held, moved)) over = true;
      flag('inPath', moving && inPath(g, s, held));
      flag('tooClose', moving && clearance(g.params, s, held) < TOO_CLOSE);
      flag('outOfSight', reading.kind === 'lost' && s.speed !== 0);
      flag('signOutOfSight', signOutOfSight(previousSign, sign, inSight));
      flag('unclear', reading.kind === 'unclear');
      if (reading.kind === 'recognised') {
        if (reading.sign === 'achtung') achtung = true;
        // counted once per run, not per sign (owner)
        if (!achtung && reading.sign !== null && MOVEMENT_SIGNS.has(reading.sign)) {
          faults.noAchtung = 1;
        }
      }
      if (reading.kind !== 'none') {
        halted = reading.kind === 'recognised' && reading.sign === 'halt';
      }
      // the same look-ahead as the HUD's contact warning, but per sim step so a replay matches
      const warned =
        s.speed !== 0 &&
        contactAhead(predictCombination(g.params, s, contacts, CONTACT_WARN_DISTANCE));
      warnedFor = warned ? warnedFor + DT : 0;
      flag('lateHalt', lateHalt(after.contacts > s.contacts, sign, warnedFor));
      if (moving && previousHeld !== null && walkedBackwards(previousHeld, held)) backwards = true;
      previousSign = sign;
      previousHeld = held;
    },
    runOver: () => over,
    halted: () => halted,
    result: () => ({ runOver: over, faults: { ...faults }, walkedBackwards: backwards }),
  };
}

/** What the Einweiser faults of a run read beyond its snapshots. */
export type EinweiserScene = {
  readonly g: SightGeometry;
  /** The layout's sight blockers (`layoutOccluders`). */
  readonly occluders: readonly Occluder[];
  /** The run's contact query, for the contact warning. */
  readonly contacts: ContactQuery;
};

/** A replay's Einweiser tracker: fed its snapshots in order, it reads him off the logged track as the live run did. */
export type EinweiserReplay = {
  /** Each snapshot after `start`, in order; returns the facts it scored. */
  update(after: SimSnapshot): EinweiserFacts;
  readonly tracker: EinweiserTracker;
};

export function createEinweiserReplay(
  { g, occluders, contacts }: EinweiserScene,
  track: EinweiserTrack,
  start: SimSnapshot,
): EinweiserReplay {
  const cursor = createTrackCursor(track);
  const reader = createReader();
  const tracker = createEinweiserTracker(g, contacts);
  let before = start;
  return {
    update(after) {
      const { held, sign, moved } = cursor.at(before.step);
      const p = perceive(g, before, held, sign, occluders);
      const reading = reader.read(sign, p, before.speed === 0);
      const facts = { before, after, held, moved, sign, inSight: p.inSight, reading };
      tracker.update(facts);
      before = after;
      return facts;
    },
    tracker,
  };
}
