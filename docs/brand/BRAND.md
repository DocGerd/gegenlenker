# Gegenlenker brand tokens

Gegenlenker inherits the DocGerdSoft neutral core, mark, Geist type, 8-pt spacing, radii and status inks. It adds one accent, teal. `src/styles/tokens.css` is the implementation; `src/styles/tokens.test.ts` checks it against the table below.

## Accent derivation

Teal is the brand `#0f7c72` in light. Every other accent value takes the OKLCH lightness and chroma of its brand-azure counterpart and teal's hue of 184.8°, with chroma reduced until the colour is inside the sRGB gamut.

## Text on the tint

Text on `--color-accent-tint` is only `--color-text` or `--color-accent-strong`: `#0f7c72` on `#e8f3f1` is 4.47:1. In dark, `--color-on-accent` is `#0d0e10`, because white on `#01afa1` is 2.75:1.

## Colour tokens

| Token                    | Light     | Dark      |
| ------------------------ | --------- | --------- |
| `--color-bg`             | `#fbfbfc` | `#0d0e10` |
| `--color-surface`        | `#ffffff` | `#15171a` |
| `--color-surface-subtle` | `#f4f5f7` | `#141619` |
| `--color-surface-muted`  | `#eef0f2` | `#1b1e22` |
| `--color-divider`        | `#e6e9ec` | `#202428` |
| `--color-border`         | `#dce0e4` | `#2a2e33` |
| `--color-text`           | `#14161a` | `#eceef1` |
| `--color-text-secondary` | `#3b4046` | `#c2c7cd` |
| `--color-text-muted`     | `#5e646b` | `#969ca4` |
| `--color-accent`         | `#0f7c72` | `#01afa1` |
| `--color-on-accent`      | `#ffffff` | `#0d0e10` |
| `--color-accent-strong`  | `#01625a` | `#60c1b5` |
| `--color-accent-tint`    | `#e8f3f1` | `#0e2623` |
| `--color-success`        | `#2e7d46` | `#5fbe7c` |
| `--color-warning`        | `#9a6b1a` | `#d6a23e` |
| `--color-danger`         | `#bc4438` | `#e0726a` |
