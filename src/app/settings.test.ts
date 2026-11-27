import { describe, expect, it } from 'vitest';
import { LAYOUT_IDS } from '../contracts/layout';
import { loadSettings, type Settings } from './settings';

const defaults: Settings = {
  version: 1,
  language: 'en',
  theme: 'system',
  truckId: 'man-le-18-280',
  trailerId: 'krone-azw-18',
  solo: false,
  aids: { pivots: true, path: true, tracks: false, ghost: true },
  topDown: 'follow',
  topDownLayout: { landscape: 0.4, portrait: 0.45 },
  collapsed: { aids: false, gauges: false, keys: false },
  graphics: 'balanced',
  lighting: 'day',
  wideMirrors: true,
  mirrorsOnly: false,
  lastEntry: null,
  fov: 90,
  mouseSensitivity: 'medium',
  invertMouse: false,
};

const stored: Settings = {
  version: 1,
  language: 'de',
  theme: 'dark',
  truckId: 'arocs-1835-ak',
  trailerId: 'hueffermann-hpa-24-81-l',
  solo: true,
  aids: { pivots: false, path: false, tracks: true, ghost: false },
  topDown: 'yard',
  topDownLayout: { landscape: 0.5, portrait: 0.35 },
  collapsed: { aids: true, gauges: true, keys: true },
  graphics: 'low',
  lighting: 'night',
  wideMirrors: false,
  mirrorsOnly: true,
  lastEntry: { role: 'einweiser', kind: 'exercise', id: 'reverse-bay' },
  fov: 110,
  mouseSensitivity: 'high',
  invertMouse: true,
};

describe('loadSettings', () => {
  it('loads a stored chase view as follow', () => {
    expect(loadSettings(JSON.stringify({ version: 1, topDown: 'chase' }), 'en').topDown).toBe(
      'follow',
    );
  });

  it('falls back to defaults for missing, corrupt or foreign data', () => {
    for (const raw of [null, '{', '[]', 'null', '42', JSON.stringify({ ...stored, version: 2 })]) {
      expect(loadSettings(raw, 'en'), String(raw)).toEqual(defaults);
    }
  });

  it('reads valid stored settings', () => {
    expect(loadSettings(JSON.stringify(stored), 'en')).toEqual(stored);
  });

  it('replaces each missing or wrong-typed field on its own', () => {
    const raw = JSON.stringify({
      version: 1,
      language: 'fr',
      theme: 'dark',
      truckId: 7,
      trailerId: 'hueffermann-hpa-24-81-l',
      solo: 'yes',
      aids: { pivots: 'no', tracks: true },
      topDown: null,
      collapsed: { aids: true, gauges: 'no' },
      graphics: 'ultra',
      lighting: 'dusk',
      wideMirrors: 'off',
      fov: 85,
      mouseSensitivity: 'fast',
      invertMouse: 'yes',
    });
    expect(loadSettings(raw, 'en')).toEqual({
      ...defaults,
      theme: 'dark',
      trailerId: 'hueffermann-hpa-24-81-l',
      aids: { ...defaults.aids, tracks: true },
      collapsed: { aids: true, gauges: false, keys: false },
    });
    expect(loadSettings(JSON.stringify({ version: 1, aids: [true] }), 'en').aids).toEqual(
      defaults.aids,
    );
  });

  it('clamps a stored top-down share to its limits and ignores non-numbers', () => {
    const layout = (v: unknown) =>
      loadSettings(JSON.stringify({ version: 1, topDownLayout: v }), 'en').topDownLayout;
    expect(layout({ landscape: 0.9, portrait: 0.1 })).toEqual({ landscape: 0.6, portrait: 0.3 });
    expect(layout({ landscape: 0.01, portrait: 0.99 })).toEqual({ landscape: 0.25, portrait: 0.6 });
    expect(layout({ landscape: '0.5', portrait: null })).toEqual(defaults.topDownLayout);
    expect(layout({ landscape: 0.5 })).toEqual({ landscape: 0.5, portrait: 0.45 });
    expect(layout([0.5])).toEqual(defaults.topDownLayout);
    expect(layout({ landscape: Number.NaN })).toEqual(defaults.topDownLayout);
  });

  it('loads a stored last entry', () => {
    const lastEntry = (v: unknown) =>
      loadSettings(JSON.stringify({ version: 1, lastEntry: v }), 'en').lastEntry;
    expect(lastEntry({ role: 'driver', kind: 'exercise', id: 'slalom' })).toEqual({
      role: 'driver',
      kind: 'exercise',
      id: 'slalom',
    });
    expect(lastEntry({ role: 'driver', kind: 'yard', id: LAYOUT_IDS[0] })).toEqual({
      role: 'driver',
      kind: 'yard',
      id: LAYOUT_IDS[0],
    });
  });

  it('drops a last entry with an unknown id, kind or role, keeping the other fields', () => {
    const bad = [
      { role: 'driver', kind: 'exercise', id: 'gone' },
      { role: 'driver', kind: 'yard', id: 'slalom' },
      { role: 'driver', kind: 'exercise', id: LAYOUT_IDS[0] },
      { role: 'driver', kind: 'lesson', id: 'slalom' },
      { role: 'dispatcher', kind: 'exercise', id: 'slalom' },
      'slalom',
      null,
    ];
    for (const lastEntry of bad) {
      const loaded = loadSettings(JSON.stringify({ version: 1, language: 'de', lastEntry }), 'en');
      expect(loaded.lastEntry, JSON.stringify(lastEntry)).toBeNull();
      expect(loaded.language).toBe('de');
    }
  });

  it('uses the detected language only when none is stored', () => {
    expect(loadSettings(null, 'de').language).toBe('de');
    expect(loadSettings(JSON.stringify({ version: 1 }), 'de').language).toBe('de');
    expect(loadSettings(JSON.stringify({ ...stored, language: 'en' }), 'de').language).toBe('en');
  });
});
