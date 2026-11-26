import type { Sight } from '../contracts/einweiser';
import type { MirrorId } from '../contracts/vehicle';
import type { MessageKey } from '../i18n/en';

/** What the sight cue says (`docs/einweiser-spike.md` §3.6). */
export type SightCue = 'unclear' | 'direct' | MirrorId | 'none';

/** Which of several paths the cue names: direct sight, then the mirror showing him largest. */
const MIRROR_ORDER: readonly MirrorId[] = [
  'mirrorLeft',
  'mirrorRight',
  'wideLeft',
  'wideRight',
  'close',
  'front',
];

/** `unclear`: the driver just met a sign it could not read, which outranks how it sees him. */
export function sightCue(sight: Sight, unclear: boolean): SightCue {
  if (unclear) return 'unclear';
  if (sight.direct) return 'direct';
  return MIRROR_ORDER.find((m) => sight.mirrors.includes(m)) ?? 'none';
}

export const SIGHT_CUE_KEY: Readonly<Record<SightCue, MessageKey>> = {
  unclear: 'sightUnclear',
  direct: 'sightDirect',
  mirrorLeft: 'sightMirrorLeft',
  mirrorRight: 'sightMirrorRight',
  wideLeft: 'sightWideLeft',
  wideRight: 'sightWideRight',
  close: 'sightClose',
  front: 'sightFront',
  none: 'sightNone',
};
