# Gegenlenker — design

"Decided" = stated by the owner. "Call" = proposed by the author, open to correction.

## Intent

A browser trainer in which truck drivers learn and practice maneuvering a truck with a turntable drawbar trailer, above all reversing. Runs offline on a tablet; works equally with keyboard or mouse.

## Goals

- Decided: trucks MAN L90 LE 18.280 and Mercedes-Benz Arocs 1835 AK; trailers Krone Box Carrier AZW 18 eL3B9 and Hüffermann HPA 24.81 L; any truck with any trailer.
- Decided: both trailers are turntable drawbar trailers (pivots at coupling and turntable).
- Decided: top-down and cockpit view visible together; cockpit has both mirrors in view, fixed forward gaze, generic steering wheel, forward / reverse / park indicator.
- Decided: tablet first; keyboard and mouse fully supported.
- Decided: offline capable, hosted on GitHub, inherits the DocGerdSoft design system with its own product look.
- Decided: not photo-realistic now; switching to photo-realistic visuals later must be easy.
- Decided: prose and comments minimal; tests only where best practice.
- Decided: left-hand drive only; German and English only.
- Decided: accessibility is low priority. Keep the brand's AA colour contrast (it also serves outdoor readability); no screen-reader, audio or reduced-motion work.
- Call: behaviour follows real vehicle geometry so the learned reflex transfers.

## Non-goals

Looking around, VR; vehicle-specific cockpits, sound; engine, gearbox, tyre-slip or load simulation; traffic, pedestrians, weather, a drivable road network; accounts, sync, telemetry; steering-wheel or gamepad hardware; a yard editor; right-hand drive; further languages; assistive-technology support.

## Anti-goals

- A trailer that reacts differently from the real one.
- Mirrors that do not show the true scene.
- Any network need after first load.
- A THW look: no ultramarine vehicles or UI, no insignia, no organisation names.
- Estimated dimensions presented as fact.

## Constraints

- Static site on GitHub Pages under `/<repo>/`: asset paths and service-worker scope are base-aware.
- No runtime request leaves the origin; Geist is self-hosted.
- Brand: neutral core, Geist / Geist Mono, 8-pt grid and radii unchanged; one product accent; WCAG 2.1 AA; light and dark via `data-theme`; mono for machine output; "© 2026 Patrick Kuhn" in the footer.
- Four views of one scene per frame at 60 fps on the reference tablet, degrading resolution before frame rate.
- Public repo, private brand repo: the app carries re-typed tokens and its own recoloured mark, as `gaproctrainer` does.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| A (picked) | Three.js scene; simulation core separate and graphics-free | Small download; mirrors are extra cameras; photo-realism later is an asset and lighting swap. |
| B | Babylon.js, same split | Same result, much larger download. |
| C | 2D top-down plus faked cockpit | Fake mirrors, no path to photo-realism. |

The owner left the choice to the author.

## Architecture

Each layer depends only on those above it.

1. **Vehicle data** — one typed file per truck and trailer. Every numeric parameter has `value`, `status: sourced | estimate`, `source`. Adding a vehicle is adding a file.
2. **Simulation core** — pure TypeScript, no DOM, no Three.js. Takes a control vector and a fixed timestep; returns a plain state snapshot. Deterministic, runs headless.
3. **Presentation** — consumes snapshots only, behind three seams:
   - `SceneRenderer`: Three.js now.
   - `VehicleVisual` per vehicle: procedural shapes from the data file now; a glTF model with the same anchor points (axles, pivots, eye, mirrors) later.
   - `Environment`: ground, markings, obstacles, lighting.
4. **App shell** — UI, input mapping, exercise flow, settings, i18n, persistence, service worker.

Photo-realism later means new `VehicleVisual` and `Environment` implementations and a quality preset. Nothing outside layer 3 imports Three.js.

### Simulation

- Three planar rigid bodies: truck, dolly (drawbar and turntable axle), trailer body. Kinematic off-axle n-trailer model, no slip.
- The coupling offset behind the truck's rear axle is a first-class parameter; it dominates reversing.
- A tandem is one effective axle at its centre.
- Both pivot angles have limits from the data file.
- Steering wheel angle maps to road-wheel angle with lock-to-lock travel and a rate limit; the sourced turning circle calibrates the lock.
- Collision: 2D oriented footprints of truck, drawbar and trailer against obstacles and each other.
- Call — contact and jackknife: a step that would penetrate an obstacle or exceed a pivot limit is rejected, the vehicle stops, the event is counted and shown. The driver recovers by driving the other way. No run is ended by an event.

### Controls (call)

Speed is a latching drive lever, not a held pedal: it stays where set, from stop to a walking-pace cap, with direction from the gear. One hand steers; the other sets speed once and is free to brake.

| Device | Steering | Speed | Brake | Gear |
|---|---|---|---|---|
| Tablet | drag wheel, right thumb | lever, left thumb | stop button | P / R / N / D selector |
| Keyboard | A / D or arrows | W / S step the lever | space | keys in an on-screen legend |
| Mouse | drag wheel | scroll wheel or click the lever | click stop | click selector |

All devices feed one mapping layer producing the core's control vector.

### Views

- One canvas, four viewports: cockpit, left mirror, right mirror, top-down.
- Mirror cameras sit at the mirror positions looking rearward, drawn flipped into mirror-shaped regions of the cockpit view, with culling corrected for the flip. One main mirror per side.
- Cockpit overlay: dashboard edge, steering wheel following the input, P / R / N / D, speed.
- Top-down: orthographic; follow or whole-yard. Switchable aids: pivot angles, predicted path of the trailer rear, wheel tracks, target ghost.

### Content

- Decided: a rough street and surroundings as visual reference while maneuvering. Each layout has an access street with kerbs and lane markings, a yard edge, and simple block landmarks (hall with gate or ramp, wall, fence, lamp posts, parked-vehicle blocks), visible in windscreen, mirrors and top-down. Kerbs, walls and blocks are collision obstacles; markings are not.
- Free yard (call): fixed preset layouts, no editor.
- Exercises, one data file each (start pose, target zone, obstacles, tolerances): straight reverse, reverse into a bay, reverse around a corner, dock at a ramp, slalom forward and back.
- Result: target reached, position and angle error, contacts, jackknife events, direction changes, time. Best results kept locally.
- Replay of the last run in the top-down view.

### App

- Vite, strict TypeScript, Three.js; no UI framework by default.
- PWA via `vite-plugin-pwa`, everything precached, update prompt.
- Geist via `@fontsource`, latin subsets.
- German and English.
- Settings and results in local storage.
- Apache-2.0 (call).
- CI: lint, type check, tests; deploy to Pages from `main`.

### Tests

Only where they catch real defects: simulation core, collision, scoring, vehicle-data validation, token values against the brand, and one browser check that the app loads and drives offline from the subpath. None for visuals, styling or glue.

## Product look

- Name (call): **Gegenlenker**; repo `DocGerd/gegenlenker`. No collision found.
- Accent (call): teal `#0F7C72`, unused by other products. The brand defines no dark, strong or tint value for teal and `#0F7C72` fails AA on dark surfaces, so the builder derives them at the brand's lightness and chroma, verifies AA and records them in `docs/brand/`.
- Character (call): an instrument, calm and exact. The views are the content; chrome sits at the edges with hairlines. Signature element: two pivot-angle gauges moving through the brand status colours as a limit approaches.
- Scene in neutral greys; accent only for target and guidance.

## Vehicle data

Starting values in mm. Estimates are flagged in the data files and listed in the README; measured values replace them without code changes.

| Vehicle | Sourced | Estimated |
|---|---|---|
| MAN LE 18.280 | width 2,490; wheelbases 3,600 / 3,900 / 4,500; rear overhang 1,100; turning radius 7.8 m at 3,900 [D] | fleet wheelbase (3,900), coupling offset (1,250), front overhang (1,320), track (1,950 / 1,800), eye and mirror points |
| Arocs 1835 AK | wheelbase 3,900; length 6,785 [B]; width 2,500; turning circle 16.3 m kerb [A] | coupling offset (1,500), overhangs (1,450 / 1,435), track (2,050 / 1,850), eye and mirror points |
| Krone AZW 18 | 2 axles, turntable; length to eye 9,045; drawbar 2,200; wheelbase 5,170; frame height 1,190–1,370 [K] | width (2,550), rear overhang (1,675), track (2,040) |
| Hüffermann HPA 24.81 L | 24 t; length 10,420; width 2,550; low-loader with wheel wells and ramps [H] | 3 axles with rear tandem, drawbar (2,600), wheelbase to tandem centre (5,600), tandem spacing (1,310), overhangs (900 / 2,220; rear = length − drawbar − wheelbase), deck height (700) |

Estimated for all: turntable limit (±85°), coupling-angle limit (±80°) (mechanical stop near 90°, where drawbar meets frame or truck rear corner), driver eye (MAN 1,950 high, 1,000 behind bumper, 400 left of centre; Arocs 2,150 / 1,300 / 500), mirror pivots (±1,250 MAN, ±1,400 Arocs).

Also estimated: mirror glass 200 outboard of the pivot, 600 / 700 behind bumper, 2,000 / 2,200 high (MAN / Arocs); Krone front overhang (600); Hüffermann track (2,040); steering 5.0 turns lock to lock, at most 1.5 turns/s.

Sources:
- [A] https://defence.mercedes-benz-trucks.com/fileadmin/Defence/Downloads/D_Technische-Daten_Arocs_ENG_screen.pdf
- [B] https://mbpassion.de/2017/04/thw-uebernimmt-41-mercedes-benz-arocs-allradkipper/
- [D] https://www.codeready.org/trucks/man-trucks/man-le-18-280-off-road-truck
- [K] https://www.krone-trailer.com/fileadmin/media/downloads/DE/Wechselsysteme/Datenblaetter/Box_Carrier/AZW_18_eL3B9_DE.pdf
- [H] https://www.thw-hamburg-nord.de/kfz/90793.htm

## Definition of done

- Every truck–trailer pair drives forward and backward in the yard and in every exercise.
- Core tests: full-lock circle reproduces each truck's sourced turning circle; coupling and turntable constraints hold through forward and reverse runs; straight reversing with a small disturbance diverges; pivot limits and contacts raise events; a run replays identically from its input log.
- Cockpit, both mirrors and top-down visible together in tablet landscape and portrait and on desktop; mirrors correctly handed.
- With the network off after one visit, the app loads from the Pages subpath and an exercise can be driven.
- Frame-rate target met on the reference tablet, checked early.
- Light and dark, German and English, AA contrast.

## Left to the builder

Integrator, timestep and speed constants; Three.js backend (verified against current docs) and resolution scaling; shape of the procedural visuals and yard; exercise layouts and tolerances; file layout and tooling, following `gaproctrainer` where it sets a convention.

## Open for the owner

1. Reference tablet (device and browser) for the performance and install check.
2. Go-ahead to create the public repo `DocGerd/gegenlenker` with Pages.
3. Optional measurements, most valuable first: coupling pin to rear axle (both trucks); Hüffermann drawbar eye to turntable centre, turntable centre to tandem centre, axle count; wheelbase of the actual MAN.
