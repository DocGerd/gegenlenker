import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYOUT_IDS } from '../contracts/layout';
import type { NightLitKey, ScenePalette, ScenePaletteKey } from '../contracts/render';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import { isOnYard } from '../render/yard-props';
import { obstaclePaletteKey } from '../render/yard-tokens';
import { legacyIrradiance } from '../render/light-rig';
import { TOP_DOWN_NIGHT_LIGHT } from '../render/look';
import { KEYS, NIGHT_KEY, tokenName } from '../render/palette';
import { REALISM_HUES } from '../render/realism-hues';
import { HUD_BAND_SHARE } from '../render/viewports';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

type Tokens = Map<string, string>;
type Theme = 'light' | 'dark';

const normalise = (value: string) => value.replace(/#[0-9a-fA-F]+/g, (hex) => hex.toLowerCase());

const brand = (() => {
  const light: Tokens = new Map();
  const dark: Tokens = new Map();
  const row = /^\|\s*`(--[a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/;
  for (const line of read('../../docs/brand/BRAND.md').split('\n')) {
    const match = row.exec(line);
    if (match?.[1] && match[2] && match[3]) {
      light.set(match[1], normalise(match[2]));
      dark.set(match[1], normalise(match[3]));
    }
  }
  return { light, dark };
})();

const css = read('./tokens.css');

function block(selector: RegExp): Tokens {
  const tokens: Tokens = new Map();
  for (const found of css.matchAll(selector)) {
    const open = found.index + found[0].length;
    const body = css.slice(open, css.indexOf('}', open));
    for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
      if (match[1] && match[2]) tokens.set(match[1], normalise(match[2].trim()));
    }
  }
  return tokens;
}

const root = block(/:root\s*\{/g);
const darkBlock = block(/\[data-theme=["']dark["']\]\s*\{/g);

const themes: Record<Theme, Tokens> = {
  light: root,
  dark: new Map([...root, ...darkBlock]),
};

const value = (token: string, theme: Theme) => themes[theme].get(token) ?? '';

const named = (tokens: Tokens, prefix: string) =>
  [...tokens.keys()].filter((name) => name.startsWith(prefix));

describe('tokens.css matches docs/brand/BRAND.md', () => {
  it('reads every token row from BRAND.md', () => {
    expect(brand.light.size).toBeGreaterThan(0);
    for (const name of named(root, '--color-')) expect(brand.light.has(name), name).toBe(true);
  });

  it('defines every BRAND.md token with its light value in :root', () => {
    for (const [name, light] of brand.light) {
      expect(root.get(name), name).toBe(light);
    }
  });

  it('overrides in the dark block exactly the tokens whose dark value differs', () => {
    for (const [name, dark] of brand.dark) {
      if (dark === brand.light.get(name)) {
        expect(darkBlock.has(name), `${name} is not repeated in the dark block`).toBe(false);
      } else {
        expect(darkBlock.get(name), name).toBe(dark);
      }
    }
  });

  it('defines no --color-* token absent from BRAND.md', () => {
    for (const name of [...named(root, '--color-'), ...named(darkBlock, '--color-')]) {
      expect(brand.light.has(name), name).toBe(true);
    }
  });
});

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hex to OKLab: lightness 0..1, then the green-red and blue-yellow axes. */
function oklab(hex: string): [l: number, a: number, b: number] {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Hex to OKLCH: lightness 0..1, chroma, hue in degrees. */
function oklch(hex: string): [l: number, c: number, h: number] {
  const [lightness, a, b] = oklab(hex);
  return [lightness, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

const bundle: Record<string, string> = {
  '--font-sans': "'Geist', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  '--font-mono': "'Geist Mono', ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
  '--text-2xs': '11px',
  '--text-sm': '13px',
  '--leading-sm': '19px',
  '--text-md': '14px',
  '--leading-md': '22px',
  '--text-lg': '16px',
  '--leading-lg': '26px',
  '--text-xl': '20px',
  '--leading-xl': '26px',
  '--text-2xl': '24px',
  '--leading-2xl': '30px',
  '--text-3xl': '36px',
  '--leading-3xl': '40px',
  '--weight-regular': '400',
  '--weight-medium': '500',
  '--weight-semibold': '600',
  '--tracking-tight': '-0.02em',
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-6': '24px',
  '--space-8': '32px',
  '--space-12': '48px',
  '--radius-sm': '3px',
  '--radius-md': '6px',
  '--radius-lg': '10px',
  '--radius-xl': '16px',
  '--radius-pill': '100px',
};

describe('tokens.css matches the non-colour brand tokens', () => {
  for (const [name, expected] of Object.entries(bundle)) {
    it(name, () => {
      expect(value(name, 'light')).toBe(expected);
      expect(value(name, 'dark')).toBe(expected);
    });
  }
});

describe('the teal accent is derived at the brand azure lightness and chroma', () => {
  const derived = [
    ['--color-accent-strong', 'light', '#21568c'],
    ['--color-accent-tint', 'light', '#eaf1f8'],
    ['--color-accent', 'dark', '#5e9be0'],
    ['--color-accent-strong', 'dark', '#82b2e8'],
    ['--color-accent-tint', 'dark', '#16222f'],
  ] as const;

  it.each(derived)('%s %s', (token, theme, azure) => {
    const [l, c, h] = oklch(value(token, theme));
    const [la, ca] = oklch(azure);
    expect(Math.abs(l - la)).toBeLessThanOrEqual(0.003);
    expect(c).toBeLessThanOrEqual(ca + 0.002);
    expect(Math.abs(h - 184.8)).toBeLessThanOrEqual(1.5);
  });
});

const grounds = ['--color-bg', '--color-surface'];
const pairs: [foreground: string, background: string][] = [
  ...[
    '--color-text',
    '--color-text-secondary',
    '--color-text-muted',
    '--color-success',
    '--color-warning',
    '--color-danger',
    '--color-accent',
  ].flatMap((ink) => grounds.map((ground): [string, string] => [ink, ground])),
  ['--color-on-accent', '--color-accent'],
  ['--color-accent-strong', '--color-surface'],
  ['--color-accent-strong', '--color-bg'],
  ['--color-on-accent', '--color-accent-strong'],
  ['--color-text', '--color-accent-tint'],
  ['--color-accent-strong', '--color-accent-tint'],
];

describe('WCAG AA contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [foreground, background] of pairs) {
      it(`${theme}: ${foreground} on ${background}`, () => {
        expect(value(foreground, theme)).toMatch(/^#[0-9a-f]{6}$/);
        expect(value(background, theme)).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrast(value(foreground, theme), value(background, theme))).toBeGreaterThanOrEqual(
          4.5,
        );
      });
    }
  }
});

describe('non-text UI contrast', () => {
  // WCAG 1.4.11: borders (and the lever rail outline) sit on every surface, the lever fill on its rail.
  const surfaces = [...grounds, '--color-surface-muted'];
  const nonText: [indicator: string, ground: string][] = [
    ...surfaces.map((ground): [string, string] => ['--color-border', ground]),
    ['--color-accent', '--color-surface-muted'],
  ];
  for (const theme of ['light', 'dark'] as const) {
    for (const [indicator, ground] of nonText) {
      it(`${theme}: ${indicator} on ${ground} is 3:1 or more`, () => {
        expect(contrast(value(indicator, theme), value(ground, theme))).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe('HUD view frame', () => {
  // The frame is a surface ring inside a text ring: one pair that contrasts with any scene colour.
  const frame = /--hud-frame:([^;]+);/.exec(read('../hud/hud.css'))?.[1] ?? '';
  const tokens = [
    ...new Set([...frame.matchAll(/var\((--color-[a-z-]+)\)/g)].map((m) => m[1] ?? '')),
  ];

  it.each(['light', 'dark'] as const)('%s: its two colours contrast 9:1 or more', (theme) => {
    expect(tokens).toHaveLength(2);
    const [a = '', b = ''] = tokens.map((token) => value(token, theme));
    expect(contrast(a, b)).toBeGreaterThanOrEqual(9);
  });
});

describe('HUD band', () => {
  const hud = read('../hud/hud.css');

  it('has the height viewports.ts places the cockpit interior above', () => {
    const share = /--hud-band:\s*([\d.]+)%/.exec(hud)?.[1];
    expect(Number(share) / 100).toBeCloseTo(HUD_BAND_SHARE, 10);
  });

  it('sizes the band and offsets the legend from the one token', () => {
    const rule = (selector: string) =>
      new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(hud)?.[1] ?? '';
    expect(rule('.hud-band')).toMatch(/\bheight:\s*var\(--hud-band\)/);
    expect(rule('.hud-legend')).toMatch(/\bbottom:\s*calc\(var\(--hud-band\)/);
  });
});

describe('scene tokens', () => {
  const keys = Object.keys(KEYS) as ScenePaletteKey[];
  const scene = (key: string) => value(`--scene-${tokenName(key as ScenePaletteKey)}`, 'light');

  it('defines --scene-<key> for every scene palette key, as 6-digit hex, in :root only', () => {
    for (const key of keys) {
      expect(root.get(`--scene-${tokenName(key)}`), key).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(named(root, '--scene-').sort()).toEqual(
      keys.map((key) => `--scene-${tokenName(key)}`).sort(),
    );
    expect(named(darkBlock, '--scene-')).toEqual([]);
  });

  // T1: a single-tone collision object is darker than the ground it stands on, at 3.1:1 or more.
  // The street kerb and the white bay lines are exempt.
  const t1: [object: string, ground: string][] = [
    ['cone', 'yard'],
    ['band', 'yard'],
    ['band', 'verge'],
    ['wall', 'yard'],
    ['fence', 'yard'],
    ['ramp', 'yard'],
    ['parked', 'yard'],
    ['hall', 'yard'],
    ['lamp', 'yard'],
    ['lamp', 'pavement'],
  ];
  it.each(t1)('T1: %s is darker than %s with 3.1:1 or more', (object, ground) => {
    expect(luminance(scene(object)), 'darker').toBeLessThan(luminance(scene(ground)));
    expect(contrast(scene(object), scene(ground))).toBeGreaterThanOrEqual(3.1);
  });

  // T2: the dark tone of a two-tone object is T1 against its ground. The hall cannot reach 9:1
  // because its cladding has to stay 1.5:1 against the sky.
  const t2: [dark: string, light: string, min: number][] = [
    ['hall', 'cladding', 6],
    ['lamp', 'marking', 9],
  ];
  it.each(t2)('T2: %s against %s is %d:1 or more', (dark, light, min) => {
    expect(luminance(scene(dark)), 'darker').toBeLessThan(luminance(scene(light)));
    expect(contrast(scene(dark), scene(light))).toBeGreaterThanOrEqual(min);
  });

  // The hall cladding is read against the sky above it and the dark hall and fence behind it.
  it.each([
    ['cladding', 'hall'],
    ['cladding', 'fence'],
  ])('%s against %s is 3:1 or more', (a, b) => {
    expect(luminance(scene(a))).toBeGreaterThan(luminance(scene(b)));
    expect(contrast(scene(a), scene(b))).toBeGreaterThanOrEqual(3);
  });

  // T3: adjacent grounds and the sky against the darker ones; yard and pavement against sky are T4.
  const t3: [string, string][] = [
    ['yard', 'pavement'],
    ['pavement', 'street'],
    ['yard', 'street'],
    ['yard', 'verge'],
    ['pavement', 'verge'],
    ['street', 'verge'],
    ['verge', 'sky'],
    ['street', 'sky'],
    ['cladding', 'sky'],
  ];
  it.each(t3)('T3: %s against %s is 1.5:1 or more', (a, b) => {
    expect(contrast(scene(a), scene(b))).toBeGreaterThanOrEqual(1.5);
  });

  // T4: the sky is chromatic; lightness alone cannot separate it from yard and pavement.
  it.each(['yard', 'pavement'])('T4: sky is 0.08 or more from %s in OKLab', (ground) => {
    const [l1, a1, b1] = oklab(scene('sky'));
    const [l2, a2, b2] = oklab(scene(ground));
    expect(Math.hypot(l1 - l2, a1 - a2, b1 - b2)).toBeGreaterThanOrEqual(0.08);
  });

  // Own vehicle parts keep 1.5:1 against what they stand on or are seen against.
  const standing: [string, string][] = [
    ['body', 'yard'],
    ['body', 'street'],
    ['body', 'pavement'],
    ['body', 'marking'],
    ['tracks', 'yard'],
    ['tracks', 'street'],
  ];
  it.each(standing)('%s against %s is 1.5:1 or more', (thing, ground) => {
    expect(contrast(scene(thing), scene(ground))).toBeGreaterThanOrEqual(1.5);
  });

  // Aid strokes: the accent sits on a --scene-wheel casing; the casing edge reads against the ground.
  it.each(['yard', 'street'])('aid casing against %s is 3:1 or more', (ground) => {
    expect(contrast(scene('wheel'), scene(ground))).toBeGreaterThanOrEqual(3);
  });

  it('aid accent against its casing is 3:1 or more', () => {
    expect(contrast(scene('accent'), scene('wheel'))).toBeGreaterThanOrEqual(3);
  });

  // Contact marker: a marking-coloured core on the wheel casing, drawn over what is touched.
  // The core carries the dark surfaces, the casing the light ones.
  const darkContactSurfaces = [
    'cone',
    'wall',
    'ramp',
    'fence',
    'parked',
    'hall',
    'band',
    'lamp',
    'street',
    'tracks',
  ];
  it.each(darkContactSurfaces)('contact marker core against %s is 3:1 or more', (surface) => {
    expect(contrast(scene('marking'), scene(surface))).toBeGreaterThanOrEqual(3);
  });

  it.each(['yard', 'body', 'cab', 'kerb'])(
    'contact marker casing against %s is 3:1 or more',
    (surface) => {
      expect(contrast(scene('wheel'), scene(surface))).toBeGreaterThanOrEqual(3);
    },
  );

  // The legacy lights run at TOP_DOWN_NIGHT_LIGHT of the day at night, so a lit surface shows
  // lin(night token) * f * k, f being the legacy irradiance over pi; unlit strokes and markings keep their colour.
  const palette = Object.fromEntries(
    keys.map((key) => [key, parseInt(scene(key).slice(1), 16)]),
  ) as unknown as ScenePalette;
  const dim = (legacyIrradiance(palette) / Math.PI) * TOP_DOWN_NIGHT_LIGHT;
  /** Relative luminance of a lit surface at night: its night token, dimmed by the night light. */
  const lit = (key: string): number => luminance(scene(NIGHT_KEY[key as NightLitKey])) * dim;
  /** Relative luminance of an unlit token, which the night light does not touch. */
  const flat = (key: string): number => luminance(scene(key));
  const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  // By day the lit ground shows lin(token) * f; the unlit strokes keep their colour. A target outline
  // or gate ring reads on every ground it crosses through its casing or its core.
  describe('day top-down', () => {
    const f = legacyIrradiance(palette) / Math.PI;
    const litDay = (key: string): number => luminance(scene(key)) * f;
    const layoutsWithAids = LAYOUT_IDS.flatMap((id) =>
      exercises.filter((e) => e.layout === id).map((e) => resolveLayout(layouts[id], e)),
    );
    const groundAt = (layout: (typeof layoutsWithAids)[number], x: number, y: number): string => {
      const inside = (r: { minX: number; minY: number; maxX: number; maxY: number }) =>
        x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
      return layout.surfaces.find((s) => inside(s.rect))?.kind ?? 'verge';
    };
    const steps = Array.from({ length: 16 }, (_, i) => i / 16);
    const crossed = new Set<string>();
    for (const layout of layoutsWithAids) {
      const { target, waypoint } = layout;
      if (target !== null) {
        const { x, y, heading } = target.pose;
        const [c, s] = [Math.cos(heading), Math.sin(heading)];
        for (const u of steps)
          for (const v of steps) {
            const [lx, ly] = [(u * 2 - 1) * (target.length / 2), (v * 2 - 1) * (target.width / 2)];
            if (Math.abs(lx) < target.length / 2 - 0.5 && Math.abs(ly) < target.width / 2 - 0.5) {
              continue;
            }
            crossed.add(groundAt(layout, x + lx * c - ly * s, y + lx * s + ly * c));
          }
      }
      if (waypoint !== null) {
        for (const u of steps) {
          const a = u * 2 * Math.PI;
          crossed.add(
            groundAt(
              layout,
              waypoint.x + waypoint.radius * Math.cos(a),
              waypoint.y + waypoint.radius * Math.sin(a),
            ),
          );
        }
      }
    }

    it('crosses at least the yard', () => {
      expect(crossed.has('yard')).toBe(true);
    });

    it.each([...crossed].sort())(
      'the target outline and gate ring read on %s through their casing or core, 3:1 or more',
      (ground) => {
        const best = Math.max(
          ratio(flat('wheel'), litDay(ground)),
          ratio(flat('accent'), litDay(ground)),
        );
        expect(best).toBeGreaterThanOrEqual(3);
      },
    );
  });

  describe('night top-down', () => {
    const grounds = ['yard', 'pavement', 'street', 'verge'] as const;

    it.each(t1)('TN1: %s is darker than %s with 3.1:1 or more', (object, ground) => {
      expect(lit(object), 'darker').toBeLessThan(lit(ground));
      expect(ratio(lit(object), lit(ground))).toBeGreaterThanOrEqual(3.1);
    });

    it.each(t3.filter(([a, b]) => grounds.some((g) => g === a) && grounds.some((g) => g === b)))(
      'TN3: %s against %s is 1.5:1 or more',
      (a, b) => {
        expect(ratio(lit(a), lit(b))).toBeGreaterThanOrEqual(1.5);
      },
    );

    // The night top-down view is never brighter than the day one: each night token stays under its day token, per channel.
    it.each(Object.entries(NIGHT_KEY))(
      'the %s night token is no lighter than its day token',
      (key, nightKey) => {
        const channels = (hex: string): number[] =>
          [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const day = channels(scene(key));
        channels(scene(nightKey)).forEach((c, i) =>
          expect(c, `channel ${i}`).toBeLessThanOrEqual(day[i] ?? 0),
        );
      },
    );

    // TN-a: the night clear colour is darker than every lit ground, so the yard's edge reads against it.
    it.each(grounds)('TN-a: nightBackdrop is darker than %s with 1.5:1 or more', (ground) => {
      expect(flat('nightBackdrop'), 'darker').toBeLessThan(lit(ground));
      expect(ratio(lit(ground), flat('nightBackdrop'))).toBeGreaterThanOrEqual(1.5);
    });

    // TN-b: the unlit cores read against the night clear colour.
    it.each(['nightAccent', 'marking'])(
      'TN-b: the %s core against nightBackdrop is 3:1 or more',
      (core) => {
        expect(ratio(flat(core), flat('nightBackdrop'))).toBeGreaterThanOrEqual(3);
      },
    );

    // Aid strokes: the night accent sits on the wheel casing, and on every ground the casing edge or
    // the core reads: the casing on the lighter grounds, the core on the street.
    it('night accent against its casing is 3:1 or more', () => {
      expect(ratio(flat('nightAccent'), flat('wheel'))).toBeGreaterThanOrEqual(3);
    });

    it.each(grounds)(
      'an aid stroke reads on %s through its casing or its core, 3:1 or more',
      (ground) => {
        const best = Math.max(
          ratio(flat('wheel'), lit(ground)),
          ratio(flat('nightAccent'), lit(ground)),
        );
        expect(best).toBeGreaterThanOrEqual(3);
      },
    );

    it.each(['yard', 'street'])('night tracks against %s is 1.5:1 or more', (ground) => {
      expect(ratio(flat('nightTracks'), lit(ground))).toBeGreaterThanOrEqual(1.5);
    });

    it.each(['yard', 'street', 'pavement'])(
      'the lit body against %s is 1.5:1 or more',
      (ground) => {
        expect(ratio(lit('body'), lit(ground))).toBeGreaterThanOrEqual(1.5);
      },
    );

    it('the lit body against the unlit marking is 1.5:1 or more', () => {
      expect(ratio(lit('body'), flat('marking'))).toBeGreaterThanOrEqual(1.5);
    });

    // Contact marker: the unlit core on the dim dark surfaces, the casing on the dim light ones.
    it.each(darkContactSurfaces.filter((surface) => surface !== 'tracks'))(
      'contact marker core against %s is 3:1 or more',
      (surface) => {
        expect(ratio(flat('marking'), lit(surface))).toBeGreaterThanOrEqual(3);
      },
    );

    it('contact marker core against the night tracks is 3:1 or more', () => {
      expect(ratio(flat('marking'), flat('nightTracks'))).toBeGreaterThanOrEqual(3);
    });

    it.each(['yard', 'body', 'cab', 'kerb'])(
      'contact marker casing against %s is 3:1 or more',
      (surface) => {
        expect(ratio(flat('wheel'), lit(surface))).toBeGreaterThanOrEqual(3);
      },
    );

    // The legend swatch ground is the yard as the intermediate stores it.
    it('draws the legend swatches on the lit night yard', () => {
      const encode = (l: number): number =>
        Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055));
      const decode = (c: number): number => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const yard = scene('nightYard');
      const expected = [1, 3, 5]
        .map((i) => encode(decode(parseInt(yard.slice(i, i + 2), 16)) * dim))
        .map((c) => c.toString(16).padStart(2, '0'))
        .join('');
      const swatch =
        /\[data-render-lighting='night'\] \.hud-swatch\s*\{[^}]*background:\s*(#[0-9a-f]{6})/.exec(
          read('../hud/hud.css'),
        )?.[1];
      expect(swatch).toBe(`#${expected}`);
    });

    // Not rebased, as never a top-down pair: T2 (the hall's cladding is on side faces and the lamp's
    // marking band sits under its full-footprint head), cladding against hall and fence, and sky and
    // cladding against sky (the perspective dome); the day exceptions stay.
  });

  // Routing: a single-tone obstacle on the yard resolves to a key that satisfies T1 there.
  describe('obstacle palette keys over the resolved layouts', () => {
    const resolved = LAYOUT_IDS.flatMap((id) => [
      resolveLayout(layouts[id], null),
      ...exercises.filter((e) => e.layout === id).map((e) => resolveLayout(layouts[id], e)),
    ]);
    const keyed = resolved.flatMap((layout) =>
      layout.obstacles.map((o) => ({
        o,
        onYard: isOnYard(layout.yard, o.obb.cx, o.obb.cy),
        key: obstaclePaletteKey(o.kind, isOnYard(layout.yard, o.obb.cx, o.obb.cy)),
      })),
    );

    it('every non-cone obstacle on the yard is darker than the yard, 3.1:1 or more', () => {
      const onYard = keyed.filter(({ o, onYard }) => onYard && o.kind !== 'cone');
      expect(onYard.length).toBeGreaterThan(0);
      for (const { o, key } of onYard) {
        expect(luminance(scene(key)), `${o.id} darker`).toBeLessThan(luminance(scene('yard')));
        expect(contrast(scene(key), scene('yard')), o.id).toBeGreaterThanOrEqual(3.1);
      }
    });

    it('every non-cone obstacle on the yard keeps 3.1:1 or more against the night yard', () => {
      for (const key of new Set(
        keyed.filter(({ o, onYard }) => onYard && o.kind !== 'cone').map(({ key }) => key),
      )) {
        expect(ratio(lit(key), lit('yard')), key).toBeGreaterThanOrEqual(3.1);
      }
    });

    it('fences beyond the yard take the band key, which is T1 on the verge', () => {
      const plot = keyed.filter(({ o, onYard }) => o.kind === 'fence' && !onYard);
      expect(plot.length).toBeGreaterThan(0);
      for (const { o, key } of plot) {
        expect(key, o.id).toBe('band');
        expect(contrast(scene(key), scene('verge')), o.id).toBeGreaterThanOrEqual(3.1);
      }
      const edge = keyed.filter(({ o, onYard }) => o.kind === 'fence' && onYard);
      for (const { o, key } of edge) expect(key, o.id).toBe('fence');
    });

    it('street kerbs keep the kerb key and yard kerbs the band key', () => {
      const kerbs = keyed.filter(({ o }) => o.kind === 'kerb');
      expect(kerbs.some(({ onYard }) => !onYard)).toBe(true);
      expect(kerbs.some(({ onYard }) => onYard)).toBe(true);
      for (const { onYard, key } of kerbs) expect(key).toBe(onYard ? 'band' : 'kerb');
    });
  });
});

describe('perspective-only realism hues', () => {
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const documented = new Map<string, string>();
  const section = read('../../docs/brand/BRAND.md').split('## Perspective-only realism hues')[1];
  for (const m of (section ?? '').matchAll(/^\|\s*`([A-Za-z]+)`\s*\|\s*`(#[0-9a-fA-F]{6})`/gm)) {
    if (m[1] && m[2]) documented.set(m[1], m[2].toLowerCase());
  }
  const hues = Object.entries(REALISM_HUES).map(([key, n]): [string, string] => [key, hex(n)]);

  it('lists exactly the hues of the render module in BRAND.md', () => {
    expect(Object.fromEntries(documented)).toEqual(Object.fromEntries(hues));
  });

  it('keeps every hue distinct', () => {
    expect(new Set(hues.map(([, h]) => h)).size).toBe(hues.length);
  });

  it('keeps every hue out of the colour and scene tokens, so none reaches a top-down face', () => {
    const tokens = new Set(
      [...root, ...darkBlock].map(([, v]) => v).filter((v) => /^#[0-9a-f]{6}$/.test(v)),
    );
    expect(tokens.size).toBeGreaterThan(0);
    for (const [key, h] of hues) expect(tokens.has(h), key).toBe(false);
  });
});
