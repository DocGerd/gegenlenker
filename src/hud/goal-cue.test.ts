import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n/i18n';
import type { GoalCue } from '../scoring/score';
import { goalCueTexts } from './goal-cue';

const outside = (distance: number, angleOk: boolean): GoalCue => ({
  state: 'outside',
  distance,
  positionOk: false,
  angleOk,
});

describe('goalCueTexts', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: {} });
    setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the announced state still while the distance counts down', () => {
    const a = goalCueTexts(outside(2.43, true));
    const b = goalCueTexts(outside(2.31, true));
    expect(b.distance).not.toBe(a.distance);
    expect(b.state).toBe(a.state);
  });

  it('changes the state with the verdict, not with the distance', () => {
    const states = [
      goalCueTexts(outside(2, true)),
      goalCueTexts(outside(2, false)),
      goalCueTexts({ state: 'outside', distance: 0.2, positionOk: true, angleOk: false }),
      goalCueTexts({ state: 'inside', distance: 0.2, positionOk: true, angleOk: true }),
    ].map((cue) => cue.state);
    expect(new Set(states).size).toBe(4);
  });

  it('formats the distance in the UI language', () => {
    setLanguage('de');
    expect(goalCueTexts(outside(2.43, true)).distance).toBe('2,4 m · ');
    setLanguage('en');
    expect(goalCueTexts(outside(2.43, true)).distance).toBe('2.4 m · ');
  });
});
