import { describe, expect, it } from 'vitest';
import { HOLD_STEPS } from '../contracts/einweiser';
import type { InputLog } from '../contracts/exercise';
import { guidedRun, resolveRun } from '../content/run';
import { parseInputLog, serializeInputLog, type RunIds } from '../sim/replay';
import { createSimulation } from '../sim/simulation';
import { layoutOccluders, sightGeometry } from './sight';
import { createEinweiserRun, createTrackCursor, type EinweiserInput, type TrackAt } from './track';
import { STILL } from './walk';

const ids: RunIds = {
  layoutId: 'depot',
  exerciseId: null,
  truckId: 'man-le-18-280',
  trailerId: 'krone-azw-18',
  role: 'einweiser',
};

/** Stands with arms down, then walks forward looking up and shows Achtung, then stands again. */
function drive(steps: number) {
  const run = guidedRun(ids);
  const g = sightGeometry(run.truck, run.trailer);
  const sim = createSimulation(run.params, run.start, run.contacts);
  let s = sim.snapshot();
  const einweiser = createEinweiserRun({
    g,
    occluders: layoutOccluders(run.layout),
    yard: run.layout.yard,
    start: s,
  });
  const heading = einweiser.walker().heading;
  const live: TrackAt[] = [];
  for (let i = 0; i < steps; i++) {
    const walking = i >= 30 && i < 90;
    const input: EinweiserInput = {
      keys: walking ? { ...STILL, forward: true } : STILL,
      heading,
      pitch: walking ? 0.12345 : 0,
      sign: i >= 30 ? 'achtung' : null,
    };
    const step = einweiser.step(s, input);
    live.push({ held: einweiser.held(), sign: input.sign, moved: step.moved });
    s = sim.step(step.control);
  }
  return { track: einweiser.track(), live };
}

describe('Einweiser track', () => {
  it('records the held pose change-only on hold steps, with pitch, and each sign change', () => {
    const { track } = drive(180);
    expect(track.samples[0]?.step).toBe(0);
    expect(track.samples.every((p) => p.step % HOLD_STEPS === 0)).toBe(true);
    // standing still adds no sample after the first, before the walk or once he has stopped (walk ramp)
    expect(track.samples.filter((p) => p.step < 30)).toHaveLength(1);
    expect(track.samples.filter((p) => p.step > 120)).toHaveLength(0);
    expect(track.samples.some((p) => p.pitch === 0.123)).toBe(true);
    expect(track.signs).toEqual([{ step: 30, sign: 'achtung' }]);
  });

  it('replays what the live run read of him at every step, through the stored log', () => {
    const steps = 180;
    const { track, live } = drive(steps);
    const log: InputLog = {
      ...ids,
      version: 4,
      einweiser: track,
      lighting: 'day',
      mirrorsOnly: false,
      steps,
      changes: [],
    };
    const fingerprint = (i: RunIds): string => resolveRun(i).fingerprint;
    const stored = parseInputLog(serializeInputLog(log, fingerprint), fingerprint);
    if (stored?.einweiser === undefined) throw new Error('stored track expected');
    const cursor = createTrackCursor(stored.einweiser);
    expect(live.some((at) => at.moved > 0)).toBe(true);
    expect(live.map((_, step) => cursor.at(step))).toEqual(live);
  });
});
