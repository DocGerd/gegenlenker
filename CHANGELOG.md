# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project has no tagged release yet, so everything is listed under Unreleased.

Pending changes live as fragments in `changelog.d/` and are folded into this file at release; see `changelog.d/README.md`.

## [Unreleased]

### Added

- Trainer for two trucks and two turntable drawbar trailers (four pairs) with a kinematic simulation, rejected-step handling and oriented-box collision ([#13](https://github.com/DocGerd/gegenlenker/pull/13), [#6](https://github.com/DocGerd/gegenlenker/pull/6), [#8](https://github.com/DocGerd/gegenlenker/pull/8)).
- Yard with a street and five exercises, plus a free-yard mode ([#11](https://github.com/DocGerd/gegenlenker/pull/11)).
- Four views (cockpit, two mirrors, top-down) with a resolution fallback, and a HUD with pivot-angle gauges ([#12](https://github.com/DocGerd/gegenlenker/pull/12), [#14](https://github.com/DocGerd/gegenlenker/pull/14)).
- Touch, keyboard and mouse controls, including speed-lever ramping on W/S and Up/Down ([#9](https://github.com/DocGerd/gegenlenker/pull/9), [#85](https://github.com/DocGerd/gegenlenker/pull/85), [#94](https://github.com/DocGerd/gegenlenker/pull/94)).
- Scoring with per-criterion results, assisted and unaided bests, and a replay with scrubber, event markers and speed control ([#7](https://github.com/DocGerd/gegenlenker/pull/7), [#84](https://github.com/DocGerd/gegenlenker/pull/84)).
- German and English UI ([#1](https://github.com/DocGerd/gegenlenker/pull/1), [#97](https://github.com/DocGerd/gegenlenker/pull/97)).
- Installable offline PWA with an update prompt, update check, wake lock, offline status and a WebGL check ([#5](https://github.com/DocGerd/gegenlenker/pull/5), [#73](https://github.com/DocGerd/gegenlenker/pull/73), [#124](https://github.com/DocGerd/gegenlenker/pull/124)).
- Pause sheet with an unscored restart when leaving a run ([#75](https://github.com/DocGerd/gegenlenker/pull/75)).
- Top-down aids: zoom and pan, the Vorausschau trace for truck and trailer, a marked slalom turn point, and a contact marker naming the body part ([#50](https://github.com/DocGerd/gegenlenker/pull/50), [#37](https://github.com/DocGerd/gegenlenker/pull/37), [#74](https://github.com/DocGerd/gegenlenker/pull/74), [#92](https://github.com/DocGerd/gegenlenker/pull/92)).
- Clearer exercise goals while driving ([#82](https://github.com/DocGerd/gegenlenker/pull/82)).
- Perspective realism: procedural vehicle detail, contact shadows, sky haze with an industrial skyline, RMS road markings, a German industrial yard and the remaining yard props ([#77](https://github.com/DocGerd/gegenlenker/pull/77), [#80](https://github.com/DocGerd/gegenlenker/pull/80), [#81](https://github.com/DocGerd/gegenlenker/pull/81), [#120](https://github.com/DocGerd/gegenlenker/pull/120), [#83](https://github.com/DocGerd/gegenlenker/pull/83), [#91](https://github.com/DocGerd/gegenlenker/pull/91), [#125](https://github.com/DocGerd/gegenlenker/pull/125)).
- Cab shell model built by a Blender pipeline pilot ([#127](https://github.com/DocGerd/gegenlenker/pull/127)).
- Graphics quality presets Low, Balanced and High in settings, defaulting to Balanced ([#134](https://github.com/DocGerd/gegenlenker/pull/134)).

### Changed

- 4x MSAA on the mirror render targets ([#71](https://github.com/DocGerd/gegenlenker/pull/71)).
- Safe-area insets, bigger mirrors and a fix for narrow windows; mirrors stay above the controls on shorter viewports ([#128](https://github.com/DocGerd/gegenlenker/pull/128), [#47](https://github.com/DocGerd/gegenlenker/pull/47)).
- Load failures are retried; borders are 3:1 and the lever has a rail ([#86](https://github.com/DocGerd/gegenlenker/pull/86)).
- Desktop key legend is folded and the top view panels are slimmer ([#102](https://github.com/DocGerd/gegenlenker/pull/102)).

### Fixed

- Cockpit, mirrors and top-down are clearly separated, and grounds, obstacles and halls are distinguishable ([#34](https://github.com/DocGerd/gegenlenker/pull/34), [#31](https://github.com/DocGerd/gegenlenker/pull/31)).
- Top-down view draws wheels, axles, turntable and drawbar, keeps a dark casing under aid strokes, and frames the whole yard and the follow view clear of the HUD ([#35](https://github.com/DocGerd/gegenlenker/pull/35), [#76](https://github.com/DocGerd/gegenlenker/pull/76), [#114](https://github.com/DocGerd/gegenlenker/pull/114), [#78](https://github.com/DocGerd/gegenlenker/pull/78), [#106](https://github.com/DocGerd/gegenlenker/pull/106)).
- Steering wheel shows its position and the straight state, and the controls layout is corrected ([#32](https://github.com/DocGerd/gegenlenker/pull/32)).
- Cockpit forward view is no longer blocked by opaque cab glass, and the skyline draws a quay crane ([#93](https://github.com/DocGerd/gegenlenker/pull/93), [#117](https://github.com/DocGerd/gegenlenker/pull/117)).
- Slalom requires weaving, exercise order and result details are corrected ([#113](https://github.com/DocGerd/gegenlenker/pull/113), [#103](https://github.com/DocGerd/gegenlenker/pull/103)).
- Run clock and assisted flag start with the first driving input, and the final frame's time shows when a run ends in the target ([#96](https://github.com/DocGerd/gegenlenker/pull/96), [#118](https://github.com/DocGerd/gegenlenker/pull/118)).
- Result screen delta, keyboard use and leaving a run unscored ([#95](https://github.com/DocGerd/gegenlenker/pull/95)); the keyboard keeps working after the pause sheet closes ([#101](https://github.com/DocGerd/gegenlenker/pull/101)).
- HUD clock rounding and text selection on double click; cockpit layout at 1280-wide windows and Stop over counters at 1024x700 ([#112](https://github.com/DocGerd/gegenlenker/pull/112), [#107](https://github.com/DocGerd/gegenlenker/pull/107)).
