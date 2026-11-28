import { describe, expect, it } from 'vitest';
import type { SignId } from '../contracts/einweiser';
import { DT } from '../sim/constants';
import {
  createReader,
  CROSSWISE_HALF_ANGLE,
  crosswise,
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
  sight: { direct: true, mirrors: [] },
  inSight: true,
  station,
  inPath: false,
  crosswise: false,
  judge: () => ({ readable: true, facing: true, ...judged }),
});
const UNSEEN: Perception = { ...seen(), sight: { direct: false, mirrors: [] }, inSight: false };

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

  it('finds a steering sign given from the band at a standstill unclear, as it has no gear there', () => {
    const LENKEN = steps(recognitionTime('lenkenLinks'));
    expect(
      read([{ sign: 'lenkenLinks', p: seen('abeam'), steps: LENKEN, standing: true }]),
    ).toEqual([{ step: LENKEN - 1, reading: { kind: 'unclear', sign: 'lenkenLinks' } }]);
    expect(read([{ sign: 'lenkenLinks', p: seen('abeam'), steps: LENKEN }])).toEqual([
      {
        step: LENKEN - 1,
        reading: { kind: 'recognised', sign: 'lenkenLinks', station: 'abeam' },
      },
    ]);
  });

  it('bands a facing across the cab on both sides, to either side of square', () => {
    const DEG = Math.PI / 180;
    const edge = CROSSWISE_HALF_ANGLE / DEG;
    for (const cab of [0, 2]) {
      for (const square of [90, -90]) {
        const at = (off: number): boolean => crosswise(cab, cab + (square + off) * DEG);
        expect([at(-edge - 1), at(-edge + 1), at(0), at(edge - 1), at(edge + 1)]).toEqual([
          false,
          true,
          true,
          true,
          false,
        ]);
      }
      expect(crosswise(cab, cab) || crosswise(cab, cab + Math.PI)).toBe(false);
    }
  });

  it('finds a steering sign to a side unclear from the crosswise band, but not straight or Links fahren', () => {
    const across = { ...seen(), crosswise: true };
    const reading = (sign: SignId) =>
      read([{ sign, p: across, steps: steps(recognitionTime(sign)) }]).map(
        ({ reading: r }) => r.kind,
      );
    expect(reading('lenkenLinks')).toEqual(['unclear']);
    expect(reading('lenkenRechtsVoll')).toEqual(['unclear']);
    expect(reading('lenkenGerade')).toEqual(['recognised']);
    expect(reading('links')).toEqual(['recognised']);
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
