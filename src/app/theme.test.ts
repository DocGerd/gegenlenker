import { describe, expect, it } from 'vitest';
import { resolveDark } from './theme';

describe('resolveDark', () => {
  it('turns a System night drive dark on a light OS', () => {
    expect(resolveDark('system', false, true)).toBe(true);
  });

  it('keeps an explicit Light theme light at night', () => {
    expect(resolveDark('light', false, true)).toBe(false);
    expect(resolveDark('light', true, true)).toBe(false);
  });

  it('keeps an explicit Dark theme dark by day', () => {
    expect(resolveDark('dark', false, false)).toBe(true);
  });

  it('follows the OS by day under System', () => {
    expect(resolveDark('system', false, false)).toBe(false);
    expect(resolveDark('system', true, false)).toBe(true);
  });
});
