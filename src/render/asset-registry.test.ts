import { describe, expect, it } from 'vitest';
import { ASSET_REGISTRY, ATTACHMENTS, type BooleanFlag } from './asset-registry';
import { QUALITY_FLAGS } from './quality';

/** Flags that publish no marker: the haze is in place as soon as the grade is, and the grade check compiles the shadow receivers. */
const SYNC_FLAGS: readonly BooleanFlag[] = ['aerialPerspective', 'sunShadow', 'lampShadow'];

const booleanFlags = (
  Object.keys(QUALITY_FLAGS.high) as (keyof typeof QUALITY_FLAGS.high)[]
).filter((k): k is BooleanFlag => typeof QUALITY_FLAGS.high[k] === 'boolean');

describe('ATTACHMENTS', () => {
  const covered = new Set<BooleanFlag>([
    ...SYNC_FLAGS,
    ...Object.values(ATTACHMENTS).flatMap((a) => a.flags),
  ]);

  it.each(booleanFlags.filter((f) => QUALITY_FLAGS.high[f] && !QUALITY_FLAGS.balanced[f]))(
    'covers the High-only flag %s',
    (flag) => {
      expect(covered.has(flag)).toBe(true);
    },
  );

  it.each([...new Set(Object.values(ASSET_REGISTRY).map((a) => a.flag))])(
    'covers the asset flag %s',
    (flag) => {
      expect(covered.has(flag)).toBe(true);
    },
  );

  it('gives every attachment its own marker', () => {
    const markers = Object.values(ATTACHMENTS).map((a) => a.marker);
    expect(new Set(markers).size).toBe(markers.length);
  });
});
