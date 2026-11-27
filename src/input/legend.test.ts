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

describe('driver legend', () => {
  it('is the same rows in every combination', () => {
    const out: Record<string, string[]> = {};
    for (const chase of [false, true])
      for (const look of [false, true])
        for (const mirrorsOnly of [false, true])
          out[`chase=${chase} look=${look} mirrorsOnly=${mirrorsOnly}`] = driveLegendRows({
            chase,
            look,
            mirrorsOnly,
          }).map(
            (r) =>
              `${typeof r.term === 'string' ? r.term : `{${r.term.key}}`} | ${r.desc}${r.viewOnly ? ' | view' : ''}`,
          );
    expect(out).toMatchInlineSnapshot(`
      {
        "chase=false look=false mirrorsOnly=false": [
          "A / D · ← / → | steer",
          "C | resetSteer",
          "W / S · ↑ / ↓ | speed",
          "{keySpace} | stop",
          "1–4 = P / R / N / D | gear",
          "H / X | lampKeys | view",
          "{keyEsc} | pause | view",
          "F / Y | viewSwitchNoOutside | view",
          "{keyWheel} | steer | view",
          "{keyLever} | speed | view",
          "+ / − | zoom | view",
          "{keyScroll} | zoom | view",
          "{keyDrag} | panView | view",
          "0 / L | resetViewAndSize | view",
        ],
        "chase=false look=false mirrorsOnly=true": [
          "A / D · ← / → | steer",
          "C | resetSteer",
          "W / S · ↑ / ↓ | speed",
          "{keySpace} | stop",
          "1–4 = P / R / N / D | gear",
          "H / X | lampKeys | view",
          "{keyEsc} | pause | view",
          "{keyWheel} | steer | view",
          "{keyLever} | speed | view",
        ],
        "chase=false look=true mirrorsOnly=false": [
          "A / D · ← / → | steer",
          "C | resetSteer",
          "W / S · ↑ / ↓ | speed",
          "{keySpace} | stop",
          "1–4 = P / R / N / D | gear",
          "H / X | lampKeys | view",
          "{keyEsc} | pause | view",
          "F / Y | viewSwitchNoOutside | view",
          "{keyWheel} | steer | view",
          "{keyLever} | speed | view",
          "+ / − | zoom | view",
          "{keyScroll} | zoom | view",
          "{keyDrag} | panView | view",
          "Q / E | lookAround | view",
          "0 / L | resetViewAndSize | view",
        ],
        "chase=false look=true mirrorsOnly=true": [
          "A / D · ← / → | steer",
          "C | resetSteer",
          "W / S · ↑ / ↓ | speed",
          "{keySpace} | stop",
          "1–4 = P / R / N / D | gear",
          "H / X | lampKeys | view",
          "{keyEsc} | pause | view",
          "{keyWheel} | steer | view",
          "{keyLever} | speed | view",
          "Q / E | lookAround | view",
        ],
        "chase=true look=false mirrorsOnly=false": [
          "A / D · ← / → | steer",
          "C | resetSteer",
          "W / S · ↑ / ↓ | speed",
          "{keySpace} | stop",
          "1–4 = P / R / N / D | gear",
          "H / X | lampKeys | view",
          "{keyEsc} | pause | view",
          "F / Y / O | viewSwitch | view",
          "{keyWheel} | steer | view",
          "{keyLever} | speed | view",
          "+ / − | zoom | view",
          "{keyScroll} | zoom | view",
          "{keyDrag} | panView | view",
          "{keyOrbitTilt} | orbitTilt | view",
          "0 / L | resetViewAndSize | view",
        ],
        "chase=true look=false mirrorsOnly=true": [
          "A / D · ← / → | steer",
          "C | resetSteer",
          "W / S · ↑ / ↓ | speed",
          "{keySpace} | stop",
          "1–4 = P / R / N / D | gear",
          "H / X | lampKeys | view",
          "{keyEsc} | pause | view",
          "{keyWheel} | steer | view",
          "{keyLever} | speed | view",
        ],
        "chase=true look=true mirrorsOnly=false": [
          "A / D · ← / → | steer",
          "C | resetSteer",
          "W / S · ↑ / ↓ | speed",
          "{keySpace} | stop",
          "1–4 = P / R / N / D | gear",
          "H / X | lampKeys | view",
          "{keyEsc} | pause | view",
          "F / Y / O | viewSwitch | view",
          "{keyWheel} | steer | view",
          "{keyLever} | speed | view",
          "+ / − | zoom | view",
          "{keyScroll} | zoom | view",
          "{keyDrag} | panView | view",
          "{keyOrbitTilt} | orbitTilt | view",
          "Q / E | lookAround | view",
          "0 / L | resetViewAndSize | view",
        ],
        "chase=true look=true mirrorsOnly=true": [
          "A / D · ← / → | steer",
          "C | resetSteer",
          "W / S · ↑ / ↓ | speed",
          "{keySpace} | stop",
          "1–4 = P / R / N / D | gear",
          "H / X | lampKeys | view",
          "{keyEsc} | pause | view",
          "{keyWheel} | steer | view",
          "{keyLever} | speed | view",
          "Q / E | lookAround | view",
        ],
      }
    `);
  });
});

describe('the Einweiser legend', () => {
  const rows = (mirrorsOnly: boolean) =>
    driveLegendRows({ chase: false, look: false, mirrorsOnly, role: 'einweiser' }).map(
      (r) => r.desc,
    );

  it('lists his keys and the shared ones, and none of the driver controls', () => {
    expect(rows(false)).toEqual([
      'walk',
      'jog',
      'mouseLook',
      'signKeys',
      'signHalt',
      'signLeftRight',
      'signMouse',
      'pause',
      'viewSwitchNoOutside',
      'zoom',
      'resetViewAndSize',
    ]);
  });

  it('drops the top-view rows without the pane', () => {
    expect(rows(true)).toEqual([
      'walk',
      'jog',
      'mouseLook',
      'signKeys',
      'signHalt',
      'signLeftRight',
      'signMouse',
      'pause',
    ]);
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
