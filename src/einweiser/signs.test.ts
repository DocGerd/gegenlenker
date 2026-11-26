import { describe, expect, it } from 'vitest';
import type { SignId } from '../contracts/einweiser';
import { DT } from '../sim/constants';
import {
  createReader,
  GRACE_CAP,
  type Judgement,
  type Perception,
  REACTION_TIME,
  type Reading,
  recognitionTime,
  type Station,
} from './signs';

const steps = (seconds: number): number => Math.round(seconds / DT);
const seen = (station: Station = 'behind', judged: Partial<Judgement> = {}): Perception => ({
  inSight: true,
  station,
  inPath: false,
  judge: () => ({ readable: true, facing: true, ...judged }),
});
const UNSEEN: Perception = { ...seen(), inSight: false };

type Frame = { sign: SignId | null; p: Perception; steps: number; standing?: boolean };

/** Every reading but `none`, with the step it came on. */
function read(frames: readonly Frame[]): { step: number; reading: Reading }[] {
  const reader = createReader();
  const out: { step: number; reading: Reading }[] = [];
  let step = 0;
  for (const { sign, p, steps: n, standing = false } of frames) {
    for (let k = 0; k < n; k++, step++) {
      const reading = reader.read(sign, p, standing);
      if (reading.kind !== 'none') out.push({ step, reading });
    }
  }
  return out;
}

const HERKOMMEN = steps(recognitionTime('herkommen'));
const LOSS = steps(REACTION_TIME);

describe('reading the Einweiser', () => {
  it('acts on a sign only once it has shown for its recognition time', () => {
    expect(
      read([
        { sign: 'herkommen', p: seen(), steps: HERKOMMEN - 1 },
        { sign: 'links', p: seen(), steps: 1 },
      ]).map(({ reading }) => reading.kind),
    ).toEqual([]);
    expect(read([{ sign: 'herkommen', p: seen(), steps: HERKOMMEN }])).toEqual([
      {
        step: HERKOMMEN - 1,
        reading: { kind: 'recognised', sign: 'herkommen', station: 'behind' },
      },
    ]);
  });

  it('finds Herkommen given inside the abeam band unclear', () => {
    expect(read([{ sign: 'herkommen', p: seen('abeam'), steps: HERKOMMEN }])).toEqual([
      { step: HERKOMMEN - 1, reading: { kind: 'unclear', sign: 'herkommen' } },
    ]);
  });

  it('reads the band reaching him while Herkommen is held as a stop, not as unclear', () => {
    const readings = read([
      { sign: 'herkommen', p: seen('behind'), steps: HERKOMMEN },
      { sign: 'herkommen', p: seen('abeam'), steps: HERKOMMEN },
    ]).map(({ reading }) => reading);
    expect(readings).toEqual([
      { kind: 'recognised', sign: 'herkommen', station: 'behind' },
      { kind: 'recognised', sign: 'herkommen', station: 'abeam' },
    ]);
  });

  it('finds a sign unclear when its hands are not readable, Halt included, or he faces away from a movement sign', () => {
    const kinds = (sign: SignId, judged: Partial<Judgement>) =>
      read([{ sign, p: seen('behind', judged), steps: steps(recognitionTime(sign)) }]).map(
        ({ reading }) => reading.kind,
      );
    expect(kinds('halt', { readable: false })).toEqual(['unclear']);
    expect(kinds('herkommen', { facing: false })).toEqual(['unclear']);
    expect(kinds('halt', { facing: false })).toEqual(['recognised']);
  });

  it('forgives a loss of sight shorter than the reaction time and stops for one that lasts it', () => {
    const moving = read([
      { sign: 'herkommen', p: seen(), steps: HERKOMMEN },
      { sign: 'herkommen', p: UNSEEN, steps: LOSS - 1 },
      { sign: 'herkommen', p: seen(), steps: 10 },
      { sign: 'herkommen', p: UNSEEN, steps: LOSS },
    ]);
    expect(moving.map(({ reading }) => reading.kind)).toEqual(['recognised', 'lost']);
    expect(moving[1]?.step).toBe(HERKOMMEN + LOSS - 1 + 10 + LOSS - 1);
  });

  it('stops once the forgiven losses since the vehicle last stood pass the cap', () => {
    const blink = (n: number, standing = false): Frame[] => [
      { sign: 'herkommen', p: UNSEEN, steps: n, standing },
      { sign: 'herkommen', p: seen(), steps: 5, standing },
    ];
    const short = LOSS - 2;
    const count = Math.floor(steps(GRACE_CAP) / short);
    const kinds = (frames: Frame[]) => read(frames).map(({ reading }) => reading.kind);
    const start: Frame = { sign: 'herkommen', p: seen(), steps: HERKOMMEN };
    const losses = Array.from({ length: count + 1 }, () => blink(short)).flat();
    expect(kinds([start, ...losses])).toEqual(['recognised', 'lost']);
    // standing in between resets the sum
    const rested = [
      ...Array.from({ length: count }, () => blink(short)).flat(),
      { sign: 'herkommen' as const, p: seen(), steps: 1, standing: true },
      ...blink(short),
    ];
    expect(kinds([start, ...rested])).toEqual(['recognised']);
  });

  it('restarts after a lost-sight stop only once the held sign is recognised again in sight', () => {
    const readings = read([
      { sign: 'herkommen', p: seen(), steps: HERKOMMEN },
      { sign: 'herkommen', p: UNSEEN, steps: LOSS + 30 },
      { sign: 'herkommen', p: seen(), steps: HERKOMMEN },
    ]);
    expect(readings.map(({ step, reading }) => [step, reading.kind])).toEqual([
      [HERKOMMEN - 1, 'recognised'],
      [HERKOMMEN + LOSS - 1, 'lost'],
      [HERKOMMEN + LOSS + 30 + HERKOMMEN - 1, 'recognised'],
    ]);
  });
});
