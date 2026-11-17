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

## Scene tokens

Scene colours are theme-independent neutral greys, except the red obstacle cone. Red marks obstacles only; the accent marks target and guidance only. `tokens.test.ts` checks these targets on the hex values (light-theme `:root`), where contrast is `(L1 + 0.05) / (L2 + 0.05)` on relative luminance:

- **T1, single-tone collision object:** darker than the ground it stands on, contrast 3.1:1 or more (about 3.0:1 lit on the top face). Pairs: cone, yard kerb (`--scene-band`), wall, fence, ramp, parked trailer, hall and lamp on yard; lamp on pavement. The cone is T1 in red; its white bands are decoration, not T2.
- **T2, two-tone object:** the two tones differ by 9:1 or more, and the dark tone is T1 against its ground. Pairs: hall against cladding, lamp against its white plinth band.
- **T3, adjacent grounds:** 1.5:1 or more. Pairs: yard, pavement, street and verge against each other, verge and street against sky.
- **Exceptions:** street kerb against pavement, white bay lines on yard, pavement against sky, and the cab (`#eef0f2`) against yard or cladding (1.49:1, unchanged).
- **Vehicle parts:** body, and tracks, keep 1.5:1 or more against the ground they stand on, and the body against marking and hall cladding.

| Token              | Value     | Role                                      |
| ------------------ | --------- | ----------------------------------------- |
| `--scene-yard`     | `#c2c7cd` | ground                                    |
| `--scene-street`   | `#5e646b` | ground                                    |
| `--scene-pavement` | `#f4f5f7` | ground                                    |
| `--scene-verge`    | `#7f858d` | ground                                    |
| `--scene-cone`     | `#b5392e` | T1 on yard, with white bands              |
| `--scene-band`     | `#202428` | T1 on yard: yard kerbs, cone base plate   |
| `--scene-wall`     | `#5e646b` | T1 on yard                                |
| `--scene-hall`     | `#202428` | T2 with cladding; T1 on yard; roof        |
| `--scene-cladding` | `#c2c7cd` | hall above 2.4 m                          |
| `--scene-body`     | `#969ca4` | yard, street, pavement, marking, cladding |
| `--scene-tracks`   | `#3b4046` | yard, street                              |
