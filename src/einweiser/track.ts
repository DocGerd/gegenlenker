import type { EinweiserPose, EinweiserStatus, ReadingKind, SignId } from '../contracts/einweiser';
import type { EinweiserSample, EinweiserTrack } from '../contracts/exercise';
import type { Rect2 } from '../contracts/layout';
import type { ControlVector, SimSnapshot } from '../contracts/sim';
import { DT } from '../sim/constants';
import { MAX_REPLAY_STEPS } from '../sim/replay';
import { createDriver, createPilot, type Pilot } from './driver';
import { bodyOccluders, type Occluder, type SightGeometry } from './sight';
import type { Perception, Reading } from './signs';
import { startWalker, walkStep, type WalkKeys, type Walker } from './walk';

/** His pose is sampled every this many steps (10 Hz, estimate) and held in between (`docs/einweiser-spike.md` §5). */
export const HOLD_STEPS = 6;

/** What the trainee does in one step: walk keys, look and the sign key held. */
export type EinweiserInput = {
  readonly keys: WalkKeys;
  /** His facing, radians in the sim plane. */
  readonly heading: number;
  readonly pitch: number;
  readonly sign: SignId | null;
};

export type EinweiserStep = {
  /** For this step's `sim.step`. */
  readonly control: ControlVector;
  readonly perception: Perception;
  /** This step's reading alone; `status.reading` keeps the latest one that was not `none`. */
  readonly reading: Reading;
  /** How far the held pose moved at its latest sample: the run-over margin (`runOver`). */
  readonly moved: number;
  readonly status: EinweiserStatus;
};

/** One Einweiser run: his walk, the held pose, the AI driver and the track, a fixed step at a time. */
export type EinweiserRun = {
  /** At `s`, before the sim steps with the returned control; once per sim step from step 0. */
  step(s: SimSnapshot, input: EinweiserInput): EinweiserStep;
  /** His pose and velocity after the latest step (the start pose before the first). */
  walker(): Walker;
  held(): EinweiserPose;
  /** Change-only, keyed by sim step: the log's `einweiser` track. */
  track(): EinweiserTrack;
};

export type EinweiserRunSetup = {
  readonly g: SightGeometry;
  /** The layout's sight blockers (`layoutOccluders`); the combination's bodies are added per step. */
  readonly occluders: readonly Occluder[];
  readonly yard: Rect2;
  /** The run's first snapshot: he starts behind the trailer (`startWalker`). */
  readonly start: SimSnapshot;
  /** The pilot the driver acts through; pass one to look ahead with its forks. */
  readonly pilot?: Pilot;
};

/** 1 cm and 1 mrad. */
const quantise = (w: Walker, pitch: number): EinweiserPose => ({
  x: Math.round(w.x * 100) / 100,
  y: Math.round(w.y * 100) / 100,
  heading: Math.round(w.heading * 1000) / 1000,
  pitch: Math.round(pitch * 1000) / 1000,
});

const samePose = (a: EinweiserSample, b: EinweiserPose): boolean =>
  a.x === b.x && a.y === b.y && a.heading === b.heading && a.pitch === b.pitch;

export function createEinweiserRun({
  g,
  occluders,
  yard,
  start,
  pilot = createPilot(g.params),
}: EinweiserRunSetup): EinweiserRun {
  const driver = createDriver(g, occluders, pilot);
  let walker = startWalker(g.params, start);
  let held = quantise(walker, 0);
  let moved = 0;
  let shown: SignId | null = null;
  let shownSince = start.step;
  let latest: ReadingKind = 'none';
  const samples: EinweiserSample[] = [];
  const signs: { step: number; sign: SignId | null }[] = [];

  return {
    step(s, input) {
      const colliders = [...occluders, ...bodyOccluders(g, s)];
      walker = walkStep({ ...walker, heading: input.heading }, input.keys, DT, colliders, yard);
      // the log keeps no steps past its cap
      const logged = s.step < MAX_REPLAY_STEPS;
      if (s.step % HOLD_STEPS === 0) {
        const next = quantise(walker, input.pitch);
        moved = Math.hypot(next.x - held.x, next.y - held.y);
        held = next;
        const last = samples[samples.length - 1];
        if (logged && (last === undefined || !samePose(last, held)))
          samples.push({ step: s.step, ...held });
      }
      if (input.sign !== shown) {
        [shown, shownSince] = [input.sign, s.step];
        if (logged) signs.push({ step: s.step, sign: shown });
      }
      const d = driver.step(s, input.sign, held);
      if (d.reading.kind !== 'none') latest = d.reading.kind;
      return {
        control: d.control,
        perception: d.perception,
        reading: d.reading,
        moved,
        status: {
          live: { x: walker.x, y: walker.y, heading: walker.heading, pitch: input.pitch },
          held,
          sign: shown,
          phase: (s.step - shownSince) * DT,
          sight: d.perception.sight,
          reading: latest,
        },
      };
    },
    walker: () => walker,
    held: () => held,
    track: () => ({ samples: [...samples], signs: [...signs] }),
  };
}

/** What a replay reads of him at one step, as the live run did (`EinweiserStep`). */
export type TrackAt = {
  readonly held: EinweiserPose;
  readonly sign: SignId | null;
  readonly moved: number;
};

/**
 * Reads a logged track step by step. `at` takes steps in increasing order. Before the first sample it
 * gives the first, and `moved` is 0 at step 0, where the live run measures from his unlogged start.
 */
export function createTrackCursor(track: EinweiserTrack): { at(step: number): TrackAt } {
  const { samples, signs } = track;
  const first = samples[0];
  if (first === undefined) throw new Error('an Einweiser track has at least one sample');
  let [sample, sign] = [0, -1];
  return {
    at(step) {
      while ((samples[sample + 1]?.step ?? Infinity) <= step) sample++;
      while ((signs[sign + 1]?.step ?? Infinity) <= step) sign++;
      const at = samples[sample] ?? first;
      const before = samples[sample - 1];
      // a hold step without a sample held him where he was
      const sampledHere = at.step === step - (step % HOLD_STEPS);
      const moved =
        before !== undefined && sampledHere ? Math.hypot(at.x - before.x, at.y - before.y) : 0;
      const { x, y, heading, pitch } = at;
      return { held: { x, y, heading, pitch }, sign: signs[sign]?.sign ?? null, moved };
    },
  };
}
