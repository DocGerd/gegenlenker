import { describe, expect, it } from 'vitest';
import { loadSettings, type Settings } from './settings';

const defaults: Settings = {
  version: 1,
  language: 'en',
  theme: 'system',
  truckId: 'man-le-18-280',
  trailerId: 'krone-azw-18',
  aids: { pivots: true, path: true, tracks: false, ghost: true },
  topDown: 'follow',
  collapsed: { aids: false, gauges: false, keys: false },
  graphics: 'balanced',
};

const stored: Settings = {
  version: 1,
  language: 'de',
  theme: 'dark',
  truckId: 'arocs-1835-ak',
  trailerId: 'hueffermann-hpa-24-81-l',
  aids: { pivots: false, path: false, tracks: true, ghost: false },
  topDown: 'yard',
  collapsed: { aids: true, gauges: true, keys: true },
  graphics: 'low',
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
      aids: { pivots: 'no', tracks: true },
      topDown: null,
      collapsed: { aids: true, gauges: 'no' },
      graphics: 'ultra',
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

  it('uses the detected language only when none is stored', () => {
    expect(loadSettings(null, 'de').language).toBe('de');
    expect(loadSettings(JSON.stringify({ version: 1 }), 'de').language).toBe('de');
    expect(loadSettings(JSON.stringify({ ...stored, language: 'en' }), 'de').language).toBe('en');
  });
});
