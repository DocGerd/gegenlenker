import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { BINDINGS, actionFor, isAction, legendRows, type Scope } from './keymap';

/** Physical codes a typed character can come from on a US layout. */
const US_CODES: Record<string, readonly string[]> = {
  f: ['KeyF'],
  y: ['KeyY'],
  o: ['KeyO'],
  '+': ['Equal', 'NumpadAdd'],
  '=': ['Equal'],
  '-': ['Minus', 'NumpadSubtract'],
  '0': ['Digit0', 'Numpad0'],
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
          expect(v).toMatch(/^(Key[A-Z]|Digit\d|Numpad\d|Arrow\w+|Space|Escape)$/);
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

  it('has legend text for every row', () => {
    for (const chase of [false, true]) {
      for (const { term, desc } of legendRows(chase)) {
        expect(en).toHaveProperty(desc);
        if (typeof term !== 'string') expect(en).toHaveProperty(term.key);
      }
    }
  });

  it('offers the outside-view key only with the outside view', () => {
    const terms = (chase: boolean): unknown[] => legendRows(chase).map((r) => r.term);
    expect(terms(true)).toContain('F / Y / O');
    expect(terms(false)).toContain('F / Y');
    expect(terms(false)).not.toContain('F / Y / O');
  });
});
