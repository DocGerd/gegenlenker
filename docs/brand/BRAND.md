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
| `--color-border`         | `#80878f` | `#656b72` |
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

Scene colours are theme-independent neutral greys, except the red obstacle cone and the blue sky. Red marks obstacles only; the accent marks target and guidance only. `tokens.test.ts` checks these targets on the hex values (light-theme `:root`), where contrast is `(L1 + 0.05) / (L2 + 0.05)` on relative luminance:

- **T1, single-tone collision object:** darker than the ground it stands on, contrast 3.1:1 or more. Pairs: cone, yard kerb (`--scene-band`), wall, fence, ramp, parked trailer, hall, lamp, gatehouse (wall token), bollard and barrier post (lamp token) on yard; lamp on pavement. The cone is T1 in red; its white bands are decoration, not T2.
- **T2, two-tone object:** the dark tone is T1 against its ground and the two tones differ by 9:1 or more (lamp against its white plinth band) or, for the hall, 6:1 or more (hall against cladding). The hall cannot reach 9:1: cladding must stay 1.5:1 or more against sky, which caps its lightness.
- **T3, adjacent grounds:** 1.5:1 or more. Pairs: yard, pavement, street and verge against each other, verge, street and hall cladding against sky. Cladding also stays 3:1 or more against the hall and the fence behind it.
- **T4, sky:** `--scene-sky` is the horizon colour of the sky dome (`src/render/sky.ts`); the zenith is derived from it, deeper and bluer. The perspective-only haze lightens the dome towards `skyHaze` near the horizon; the token values are what T3 and T4 check. It is chromatic so it separates from the grey grounds: OKLab distance 0.08 or more against yard and pavement, where lightness alone cannot (they bracket it); verge and street are T3.
- **Exceptions:** street kerb against pavement, white bay lines on yard, the cab against yard, the body against hall cladding (the body sits between cladding and sky in lightness), and the body on verge (unreachable: kerbs bound the yard and street).
- **Aid strokes:** the accent alone is 2.98:1 on yard and 1.18:1 on street, so every top-down accent stroke (path, corridor, ticks, pivot rays, ghost) sits on a dark casing in `--scene-wheel`. The casing is 10.65:1 against yard and 3.03:1 against street, and the accent is 3.58:1 against the casing, so the stroke reads 3:1 or more on both. Pavement and verge are lighter than street, so the casing holds there too.
- **Contact marker:** the cross at the contact point is a `--scene-marking` core on the `--scene-wheel` casing, shown over whatever is touched, so it is the one stroke that must read on dark objects too. The core is 3:1 or more against every dark surface a contact happens on (cone, wall, ramp, fence, parked trailer, hall, yard kerb, lamp, street, tracks); the casing is 3:1 or more against the light ones (yard, body, cab, kerb). Every surface is covered by one of the two. Red stays reserved for obstacles, so the marker is not red.
- **Vehicle parts:** body and tracks keep 1.5:1 or more against the ground they stand on, and the body against marking, except as listed above.

| Token              | Value     | Role                                      |
| ------------------ | --------- | ----------------------------------------- |
| `--scene-sky`      | `#b4e6ff` | horizon of the sky dome; T3, T4           |
| `--scene-backdrop` | `#dce0e4` | top-down clear colour outside the ground  |
| `--scene-yard`     | `#c2c7cd` | ground                                    |
| `--scene-street`   | `#5e646b` | ground                                    |
| `--scene-pavement` | `#f4f5f7` | ground                                    |
| `--scene-verge`    | `#7f858d` | ground                                    |
| `--scene-cone`     | `#b5392e` | T1 on yard, with white bands              |
| `--scene-band`     | `#202428` | T1 on yard: yard kerbs, cone base plate   |
| `--scene-wall`     | `#5e646b` | T1 on yard                                |
| `--scene-hall`     | `#202428` | T2 with cladding; T1 on yard; roof        |
| `--scene-cladding` | `#aeb2b7` | hall above 2.4 m                          |
| `--scene-body`     | `#969ca4` | yard, street, pavement, marking, cladding |
| `--scene-tracks`   | `#3b4046` | yard, street                              |
| `--scene-wheel`    | `#14161a` | wheels; aid stroke casing on yard, street |

## Perspective-only realism hues

Vehicle detail, yard props (fence grid, hall cladding and roofs, containers, masts, gatehouse, kerbs, concrete walls, loading ramps, cones in traffic red with white bands), the skyline buildings (textured facades, `skyline-atlas.ts`), the cockpit interior (`cockpit-interior.ts`: dashboard, pillars, header and visor) and the sky dome (haze, sun halo) may use these hues in the perspective views only, the interior in the cockpit view alone (`INTERIOR_LAYER`). They are not scene tokens: yard props draw their detail on `SKY_LAYER` while the top-down view draws a plain token copy of the same footprint, so it keeps strict tokens. None of them may be a `--color-*` or `--scene-*` value, a `ScenePalette` key or a top-down top face. T1-T4 are unchanged. `src/render/realism-hues.ts` holds them as sRGB; `tokens.test.ts` checks that the table and the module agree. RAL values are sRGB approximations. The THW truck shells (`tools/blender`, `thwBlue`, `liveryWhite`, `beaconBlue`) are livery by colour only: no lettering, emblem or maker logo. `thwBlue` is a lighter published RAL 5002 value than the darkest one, so Lambert shading under fog still reads blue; the owner may tune it.

| Key               | Value     | Use                                                       |
| ----------------- | --------- | --------------------------------------------------------- |
| `signalYellow`    | `#f9a800` | impact guard and underrun bars, RAL 1003                  |
| `chevronBlack`    | `#101214` | chevrons on the impact guard, grille, mudflaps            |
| `contourSide`     | `#f2c200` | contour marking at the sides (ECE R48/R104 style)         |
| `contourRear`     | `#d0201c` | contour marking at the rear                               |
| `tailLamp`        | `#c8102e` | tail lamps                                                |
| `sideMarker`      | `#ffb000` | amber side markers                                        |
| `plateWhite`      | `#f4f4ee` | EU number plate ground, headlamps                         |
| `plateInk`        | `#0a0a0a` | plate text, fictional only (`GL-GL 2026`)                 |
| `plateEuBlue`     | `#003399` | plate EU band                                             |
| `plateEuStar`     | `#ffcc00` | plate EU stars                                            |
| `anthracite`      | `#293133` | glass, bumper, hubs; yard and industrial family, RAL 7016 |
| `whiteAluminium`  | `#a5a5a5` | rims; yard and industrial family, RAL 9006                |
| `containerBlue`   | `#1e4a8a` | shipping container                                        |
| `containerRed`    | `#9a2d22` | shipping container                                        |
| `containerGreen`  | `#2f6b4a` | shipping container                                        |
| `containerOrange` | `#c9661c` | shipping container                                        |
| `concrete`        | `#8c8c86` | precast kerbs, walls and loading ramps                    |
| `coneRed`         | `#cc0605` | traffic cone body (RAL 3020), with white bands            |
| `skylineDark`     | `#5c6875` | glass and mid cladding of the skyline buildings           |
| `skyHaze`         | `#dcebf2` | horizon haze of the sky dome; buildings fade to it        |
| `sunHalo`         | `#fff1d0` | glow around the sun on the sky dome                       |
| `thwBlue`         | `#00387b` | THW cab, body and tarpaulin, RAL 5002 sRGB approximation  |
| `liveryWhite`     | `#f6f6f6` | THW bumper, corners, arches and stripe, RAL 9016          |
| `beaconBlue`      | `#1f6fe5` | roof light bar lens                                       |
| `headliner`       | `#6f716a` | cockpit roof header lining                                |
