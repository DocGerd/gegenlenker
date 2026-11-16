import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

/** Hex to OKLCH: lightness 0..1, chroma, hue in degrees. */
function oklch(hex: string): [l: number, c: number, h: number] {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [lightness, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

// Bare hex: the colour-literal lint rule is for UI code, and this is the reference data.
const bundle: Record<string, [light: string, dark?: string | false]> = {
  '--color-bg': ['fbfbfc', '0d0e10'],
  '--color-surface': ['ffffff', '15171a'],
  '--color-surface-subtle': ['f4f5f7', '141619'],
  '--color-surface-muted': ['eef0f2', '1b1e22'],
  '--color-divider': ['e6e9ec', '202428'],
  '--color-border': ['dce0e4', '2a2e33'],
  '--color-text': ['14161a', 'eceef1'],
  '--color-text-secondary': ['3b4046', 'c2c7cd'],
  '--color-text-muted': ['5e646b', '969ca4'],
  '--color-accent': ['0f7c72', '01afa1'],
  '--color-success': ['2e7d46', '5fbe7c'],
  '--color-warning': ['9a6b1a', 'd6a23e'],
  '--color-danger': ['bc4438', 'e0726a'],
  '--font-sans': ["'Geist', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"],
  '--font-mono': ["'Geist Mono', ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace"],
  '--text-2xs': ['11px'],
  '--text-sm': ['13px'],
  '--leading-sm': ['19px'],
  '--text-md': ['14px'],
  '--leading-md': ['22px'],
  '--text-lg': ['16px'],
  '--leading-lg': ['26px'],
  '--text-xl': ['20px'],
  '--leading-xl': ['26px'],
  '--text-2xl': ['24px'],
  '--leading-2xl': ['30px'],
  '--text-3xl': ['36px'],
  '--leading-3xl': ['40px'],
  '--weight-regular': ['400'],
  '--weight-medium': ['500'],
  '--weight-semibold': ['600'],
  '--tracking-tight': ['-0.02em'],
  '--space-1': ['4px'],
  '--space-2': ['8px'],
  '--space-3': ['12px'],
  '--space-4': ['16px'],
  '--space-6': ['24px'],
  '--space-8': ['32px'],
  '--space-12': ['48px'],
  '--radius-sm': ['3px'],
  '--radius-md': ['6px'],
  '--radius-lg': ['10px'],
  '--radius-xl': ['16px'],
  '--radius-pill': ['100px'],
};

const resolve = (token: string) => (/^[0-9a-f]{6}$/.test(token) ? `#${token}` : token);

describe('tokens.css matches the re-typed brand bundle', () => {
  for (const [name, [light, dark]] of Object.entries(bundle)) {
    it(`${name} light`, () => {
      expect(value(name, 'light')).toBe(resolve(light));
    });
    if (dark === false) continue;
    it(`${name} dark`, () => {
      expect(value(name, 'dark')).toBe(resolve(dark || light));
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

describe('scene tokens', () => {
  const keys =
    'sky verge yard pavement street marking kerb wall fence hall ramp lamp parked cone cab body chassis wheel tracks accent'.split(
      ' ',
    );

  it('defines --scene-<key> for every scene palette key, as 6-digit hex, in :root only', () => {
    for (const key of keys) {
      expect(root.get(`--scene-${key}`), key).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(named(root, '--scene-').sort()).toEqual(keys.map((key) => `--scene-${key}`).sort());
    expect(named(darkBlock, '--scene-')).toEqual([]);
  });

  it('keeps the scene accent at #0f7c72', () => {
    expect(root.get('--scene-accent')).toBe('#0f7c72');
  });

  it('keeps bodies and halls at 1.5:1 or more against the ground they stand on', () => {
    const standing: [string, string][] = [
      ['body', 'yard'],
      ['body', 'street'],
      ['hall', 'pavement'],
      ['hall', 'yard'],
    ];
    for (const [thing, ground] of standing) {
      const ratio = contrast(
        value(`--scene-${thing}`, 'light'),
        value(`--scene-${ground}`, 'light'),
      );
      expect(ratio, `${thing} on ${ground}`).toBeGreaterThanOrEqual(1.5);
    }
  });
});
