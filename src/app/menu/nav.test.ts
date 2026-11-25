import { describe, expect, it } from 'vitest';
import { entryKey, type EntryRef } from './catalogue';
import { holdsEntry, navigate, TITLE, topOf, type NavEvent, type NavState } from './nav';

const EXERCISE: EntryRef = { role: 'driver', kind: 'exercise', id: 'straight-reverse' };
const screens = (state: NavState) => state.stack.map((l) => l.screen);
const run = (events: readonly NavEvent[], steps?: () => number): NavState =>
  events.reduce((s, e) => navigate(s, e, steps), TITLE);

describe('menu navigation', () => {
  it('open pushes the target and remembers the opener', () => {
    const state = navigate(TITLE, { type: 'open', item: 'exercises' });
    expect(screens(state)).toEqual(['title', 'exercises']);
    expect(state.stack[0]?.focus).toBe('exercises');
  });

  it('pick on a list pushes setup at step 0 and remembers the row', () => {
    const state = run([
      { type: 'open', item: 'exercises' },
      { type: 'pick', entry: EXERCISE },
    ]);
    expect(screens(state)).toEqual(['title', 'exercises', 'setup']);
    expect(state.stack[1]?.focus).toBe(entryKey(EXERCISE));
    expect(topOf(state)).toEqual({ screen: 'setup', entry: EXERCISE, step: 0, focus: null });
  });

  it('back pops one level, and the title stays put', () => {
    const open = navigate(TITLE, { type: 'open', item: 'settings' });
    expect(screens(navigate(open, { type: 'back' }))).toEqual(['title']);
    expect(navigate(TITLE, { type: 'back' })).toBe(TITLE);
  });

  it('back steps through setup steps before leaving setup', () => {
    const setup = run(
      [{ type: 'open', item: 'exercises' }, { type: 'pick', entry: EXERCISE }, { type: 'next' }],
      () => 2,
    );
    expect(topOf(setup).step).toBe(1);
    const earlier = navigate(setup, { type: 'back' });
    expect(topOf(earlier)).toMatchObject({ screen: 'setup', step: 0 });
    expect(screens(navigate(earlier, { type: 'back' }))).toEqual(['title', 'exercises']);
  });

  it('next stops at the last step', () => {
    const setup = run([
      { type: 'open', item: 'exercises' },
      { type: 'pick', entry: EXERCISE },
    ]);
    expect(navigate(setup, { type: 'next' }, () => 1)).toBe(setup);
    const second = navigate(setup, { type: 'next' }, () => 2);
    expect(navigate(second, { type: 'next' }, () => 2)).toBe(second);
  });

  it('open of an action item or an unknown id changes nothing', () => {
    expect(navigate(TITLE, { type: 'open', item: 'replay' })).toBe(TITLE);
    expect(navigate(TITLE, { type: 'open', item: 'nope' })).toBe(TITLE);
  });

  it('pick of an entry the list does not hold changes nothing', () => {
    const yards = navigate(TITLE, { type: 'open', item: 'freeYard' });
    expect(navigate(yards, { type: 'pick', entry: EXERCISE })).toBe(yards);
  });

  it('next with the catalogue steps stays on the only step', () => {
    const setup = run([
      { type: 'open', item: 'exercises' },
      { type: 'pick', entry: EXERCISE },
    ]);
    expect(topOf(navigate(setup, { type: 'next' })).step).toBe(0);
  });

  it('pick and next outside their screens change nothing', () => {
    expect(navigate(TITLE, { type: 'pick', entry: EXERCISE })).toBe(TITLE);
    expect(navigate(TITLE, { type: 'next' })).toBe(TITLE);
  });

  it('home keeps the title only', () => {
    const state = run([
      { type: 'open', item: 'exercises' },
      { type: 'pick', entry: EXERCISE },
      { type: 'home' },
    ]);
    expect(screens(state)).toEqual(['title']);
  });

  it('holdsEntry is false only for the title', () => {
    expect(holdsEntry(TITLE)).toBe(false);
    expect(holdsEntry(navigate(TITLE, { type: 'open', item: 'settings' }))).toBe(true);
  });
});
