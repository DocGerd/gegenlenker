import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n/i18n';
import { NBSP, leverValueText, steerPercent, steerValueText } from './control-text';

describe('control value texts', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the side and the share of full lock in English', () => {
    setLanguage('en');
    expect(steerValueText(0.12)).toBe(`12${NBSP}%${NBSP}left`);
    expect(steerValueText(-1)).toBe(`100${NBSP}%${NBSP}right`);
    expect(leverValueText(0.8)).toBe(`80${NBSP}%`);
  });

  it('names the side in German', () => {
    setLanguage('de');
    expect(steerValueText(0.5)).toBe(`50${NBSP}%${NBSP}links`);
    expect(steerValueText(-0.5)).toBe(`50${NBSP}%${NBSP}rechts`);
  });

  it('reads a rounded zero as straight, never as 0 % left or right', () => {
    setLanguage('en');
    expect(steerValueText(0.004)).toBe('straight');
    expect(steerValueText(-0.004)).toBe('straight');
    expect(steerPercent(-0.004)).toBe(0);
    setLanguage('de');
    expect(steerValueText(0)).toBe('geradeaus');
  });
});
