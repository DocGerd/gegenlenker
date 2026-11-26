import { describe, expect, it } from 'vitest';
import { driveLegendRows, legendRowMarkup } from './legend';

const TOP_VIEW = [
  'viewSwitch',
  'viewSwitchNoOutside',
  'zoom',
  'panView',
  'orbitTilt',
  'resetViewAndSize',
];

describe('driveLegendRows', () => {
  it('a mirror-only drive lists no top-view rows', () => {
    for (const chase of [false, true]) {
      const rows = driveLegendRows({ chase, look: true, mirrorsOnly: true });
      expect(rows.filter((r) => TOP_VIEW.includes(r.desc))).toEqual([]);
    }
    const all = driveLegendRows({ chase: true, look: true, mirrorsOnly: false });
    expect(all.some((r) => TOP_VIEW.includes(r.desc))).toBe(true);
  });

  it('the outside view lists F / Y / O and orbit / tilt', () => {
    const on = driveLegendRows({ chase: true, look: false, mirrorsOnly: false });
    expect(on.some((r) => r.term === 'F / Y / O')).toBe(true);
    expect(on.some((r) => r.desc === 'orbitTilt')).toBe(true);
    const off = driveLegendRows({ chase: false, look: false, mirrorsOnly: false });
    expect(off.some((r) => r.term === 'F / Y')).toBe(true);
    expect(off.some((r) => r.desc === 'orbitTilt')).toBe(false);
  });

  it('look-around adds Q / E', () => {
    const terms = (look: boolean): unknown[] =>
      driveLegendRows({ chase: false, look, mirrorsOnly: false }).map((r) => r.term);
    expect(terms(false)).not.toContain('Q / E');
    expect(terms(true)).toContain('Q / E');
  });
});

describe('legendRowMarkup', () => {
  it('a translated term renders as data-i18n, a literal one as text', () => {
    expect(legendRowMarkup({ term: { key: 'keySpace' }, desc: 'stop', viewOnly: false })).toBe(
      '<dt class="mono" data-i18n="keySpace"></dt><dd data-i18n="stop"></dd>',
    );
    expect(legendRowMarkup({ term: 'Q / E', desc: 'lookAround', viewOnly: true })).toBe(
      '<dt class="mono hud-legend-view">Q / E</dt><dd class="hud-legend-view" data-i18n="lookAround"></dd>',
    );
  });
});
