import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { MODE_SIGNS, SIGNALLING_MODES } from '../contracts/einweiser';
import {
  BINDINGS,
  EINWEISER_DROPPED_VIEW_ACTIONS,
  SIGN_OF,
  actionFor,
  isAction,
  legendRows,
  signActionFor,
  signSlots,
  type Action,
  type Scope,
} from './keymap';

/** Physical codes a typed character can come from on a US layout. */
const US_CODES: Record<string, readonly string[]> = {
  f: ['KeyF'],
  y: ['KeyY'],
  o: ['KeyO'],
  k: ['KeyK'],
  '+': ['Equal', 'NumpadAdd'],
  '=': ['Equal'],
  '-': ['Minus', 'NumpadSubtract'],
  '0': ['Digit0', 'Numpad0'],
  ',': ['Comma'],
  '.': ['Period'],
};

const physicalCodes = (value: string): readonly string[] => {
  const codes = US_CODES[value];
  if (codes === undefined) throw new Error(`add the US physical codes of key "${value}"`);
  return codes;
};

const codesOf = (b: (typeof BINDINGS)[number]): string[] =>
  b.match.by === 'code' ? [...b.match.values] : b.match.values.flatMap(physicalCodes);

/** Scopes active together: all while driving, view and app in a replay. */
const LIVE: readonly (readonly Scope[])[] = [
  ['drive', 'view', 'app'],
  ['view', 'app'],
];

describe('keymap', () => {
  it('lists every key value in a known form', () => {
    for (const { match } of BINDINGS) {
      expect(match.values.length).toBeGreaterThan(0);
      for (const v of match.values) {
        if (match.by === 'code')
          expect(v).toMatch(
            /^(Key[A-Z]|Digit\d|Numpad\d|Arrow\w+|Page(Up|Down)|Space|Escape|Shift(Left|Right))$/,
          );
        else expect(v).toHaveLength(1);
      }
    }
  });

  it.each(LIVE)('binds no physical key twice while %s are live', (...scopes) => {
    const seen = new Map<string, string>();
    for (const b of BINDINGS.filter((x) => scopes.includes(x.scope))) {
      for (const code of new Set(codesOf(b))) {
        expect(seen.get(code), `${code} in ${b.action}`).toBeUndefined();
        seen.set(code, b.action);
      }
    }
  });

  it("binds no physical key twice while the Einweiser's scopes are live, in either signalling mode", () => {
    for (const mode of SIGNALLING_MODES) {
      const seen = new Map<string, string>();
      const live = BINDINGS.filter(
        (b) =>
          ['walk', 'sign', 'view', 'app'].includes(b.scope) &&
          !EINWEISER_DROPPED_VIEW_ACTIONS.includes(b.action) &&
          (b.modes ?? [mode]).includes(mode),
      );
      for (const b of live) {
        for (const code of new Set(codesOf(b))) {
          expect(seen.get(code), `${mode}: ${code} in ${b.action}`).toBeUndefined();
          seen.set(code, b.action);
        }
      }
    }
  });

  it('gives every action one binding', () => {
    const actions = BINDINGS.map((b) => b.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('matches by code or by lowercased key as bound', () => {
    expect(actionFor('drive', { code: 'KeyQ', key: 'a' })).toBeUndefined();
    expect(actionFor('drive', { code: 'KeyA', key: 'q' })).toBe('steerLeft');
    expect(actionFor('view', { code: 'KeyZ', key: 'Y' })).toBe('viewYard');
    expect(isAction('splitReset', { code: 'KeyL', key: 'l' })).toBe(true);
    expect(isAction('splitReset', { code: 'KeyX', key: 'l' })).toBe(false);
  });

  it('binds the lamp keys while driving only', () => {
    expect(actionFor('drive', { code: 'KeyH', key: 'h' })).toBe('lights');
    expect(actionFor('drive', { code: 'KeyX', key: 'x' })).toBe('hazard');
    expect(actionFor('view', { code: 'KeyH', key: 'h' })).toBeUndefined();
    expect(actionFor('view', { code: 'KeyX', key: 'x' })).toBeUndefined();
  });

  it('names Space like the stop button', () => {
    const space = legendRows(false).find(
      (r) => typeof r.term !== 'string' && r.term.key === 'keySpace',
    );
    expect(space?.desc).toBe('stop');
  });

  it('has legend text for every row', () => {
    for (const chase of [false, true]) {
      for (const { term, desc } of legendRows(chase, true)) {
        expect(en).toHaveProperty(desc);
        if (typeof term !== 'string') expect(en).toHaveProperty(term.key);
      }
    }
  });

  it('offers the orbit and tilt keys only with the outside view', () => {
    const terms = (chase: boolean): unknown[] => legendRows(chase).map((r) => r.term);
    expect(terms(true)).toContainEqual({ key: 'keyOrbitTilt' });
    expect(terms(false)).not.toContainEqual({ key: 'keyOrbitTilt' });
  });

  it('binds the glance keys to the physical keys, and lists them only where the cockpit looks around', () => {
    expect(actionFor('view', { code: 'KeyQ', key: 'a' })).toBe('glanceLeft');
    expect(actionFor('view', { code: 'KeyE', key: 'e' })).toBe('glanceRight');
    expect(actionFor('drive', { code: 'KeyE', key: 'e' })).toBeUndefined();
    const terms = (look: boolean): unknown[] => legendRows(false, look).map((r) => r.term);
    expect(terms(true)).toContain('Q / E');
    expect(terms(false)).not.toContain('Q / E');
    expect(legendRows(false, true).find((r) => r.term === 'Q / E')?.viewOnly).toBe(true);
  });

  it('offers the outside-view key only with the outside view', () => {
    const terms = (chase: boolean): unknown[] => legendRows(chase).map((r) => r.term);
    expect(terms(true)).toContain('F / Y / O');
    expect(terms(false)).toContain('F / Y');
    expect(terms(false)).not.toContain('F / Y / O');
  });
});

describe('the Einweiser keys', () => {
  it('walks on WASD or the arrows and jogs on Shift', () => {
    const walk = (code: string): Action | undefined => actionFor('walk', { code, key: '' });
    expect(['KeyW', 'KeyS', 'KeyA', 'KeyD'].map(walk)).toEqual([
      'walkForward',
      'walkBack',
      'walkLeft',
      'walkRight',
    ]);
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map(walk)).toEqual([
      'walkForward',
      'walkBack',
      'walkLeft',
      'walkRight',
    ]);
    expect([walk('ShiftLeft'), walk('ShiftRight')]).toEqual(['jog', 'jog']);
  });

  it('signs the nine signs on 1 to 9, with Q, E and Space as alternates', () => {
    const sign = (code: string): unknown =>
      SIGN_OF[signActionFor('tail', { code, key: '' }) ?? 'jog'];
    const nine = MODE_SIGNS.tail;
    expect(nine.map((_, i) => sign(`Digit${i + 1}`))).toEqual([...nine]);
    expect(nine.map((_, i) => sign(`Numpad${i + 1}`))).toEqual([...nine]);
    expect([sign('KeyQ'), sign('KeyE'), sign('Space')]).toEqual(['links', 'rechts', 'halt']);
    expect(sign('KeyX')).toBeUndefined();
  });

  it('steers to full lock on 7 and 8, a little on Q and E, and straight on X', () => {
    const sign = (code: string): unknown =>
      SIGN_OF[signActionFor('steering', { code, key: '' }) ?? 'jog'];
    expect(['Digit7', 'Numpad8', 'KeyQ', 'KeyE', 'KeyX', 'Digit5', 'Space'].map(sign)).toEqual([
      'lenkenLinksVoll',
      'lenkenRechtsVoll',
      'lenkenLinks',
      'lenkenRechts',
      'lenkenGerade',
      'herkommen',
      'halt',
    ]);
    expect(signSlots('steering').map((s) => s.key)).toEqual([
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      ...['Q', 'E', 'X'],
    ]);
    expect(signSlots('tail').map((s) => s.key)).toEqual(MODE_SIGNS.tail.map((_, i) => `${i + 1}`));
  });

  it('takes Q and E from the glance keys, by scope', () => {
    expect(actionFor('view', { code: 'KeyQ', key: 'q' })).toBe('glanceLeft');
    expect(actionFor('sign', { code: 'KeyQ', key: 'q' })).toBe('signLinks');
  });

  it('lists in the legend what the driver lists of the shared keys, and none of the driver keys', () => {
    const terms = legendRows(false, false, 'einweiser').map((r) => r.term);
    expect(terms).toEqual([
      'W A S D · ← ↑ ↓ →',
      { key: 'keyShift' },
      { key: 'keyMouse' },
      '1–9',
      { key: 'keySpace' },
      'Q / E',
      { key: 'keyMouseButtons' },
      { key: 'keyEsc' },
      'F / Y',
      '+ / −',
      '0 / L',
    ]);
  });

  it('lists the steering keys in the sign keys row, in place of Links/Rechts fahren', () => {
    const terms = (mode: 'tail' | 'steering'): unknown[] =>
      legendRows(false, false, 'einweiser', false, mode).map((r) => r.term);
    const tail = terms('tail');
    expect(terms('steering')).toEqual(
      tail.filter((t) => t !== 'Q / E').map((t) => (t === '1–9' ? '1–9 · Q E X' : t)),
    );
  });

  it('has legend text for every Einweiser row', () => {
    for (const mode of SIGNALLING_MODES) {
      for (const { term, desc } of legendRows(false, false, 'einweiser', false, mode)) {
        expect(en).toHaveProperty(desc);
        if (typeof term !== 'string') expect(en).toHaveProperty(term.key);
      }
    }
  });
});
