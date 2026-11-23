# User guide

Gegenlenker is a trainer for maneuvering a truck with a turntable drawbar trailer. Labels below are the English UI text; the app also runs in German.

## Open and install

- Open https://docgerd.github.io/gegenlenker/ in a current desktop or tablet browser. The graphics need WebGL 2; without it a drive does not start and the app shows a notice.
- After the first visit the app caches itself, and the menu footer shows "Ready offline". It then starts without a connection. Assets that only some graphics presets draw are cached when first used, so open such a preset once online.
- When a new version is available the app offers "Reload" or "Later".
- Installing it as an app uses the browser's own install action (for example "Install" in the address bar, or "Add to Home screen" on a tablet).
- The browser back action (Android back gesture) acts on the current drive, replay or result screen instead of leaving the app; in a drive it opens or closes the pause sheet.

## Controls

A drive has a steering wheel, a gear selector (P, R, N, D), a speed lever, a Stop button and two lamp buttons (lights, hazard lights). Select R or D to move; R drives backward. The lever sets a share of the speed cap and the gear sets the direction.

### Keyboard

- A / D or Left / Right: steer left / right. Hold to keep turning.
- C: centre the steering.
- W / S or Up / Down: raise / lower the speed lever by a step; hold to ramp.
- Space: brake (zeroes the lever; hold to keep braking).
- 1 / 2 / 3 / 4: gear P / R / N / D.
- H / X: lights / hazard lights.
- Esc: pause, and close the pause sheet again. The sheet offers Continue and Restart; in an exercise also "Finish" and "Leave without scoring", in the free yard "Menu". The Pause button in the drive opens it too.

Keys typed into a form field or the pause sheet do not drive, and combinations with Ctrl, Alt or Meta are ignored.

### Touch and mouse

- Steering wheel: drag around its centre. Mouse wheel over it steers in steps. The button beside it centres the steering.
- Speed lever: drag along it, or scroll over it with the mouse wheel.
- Stop: hold to brake.
- Gear and lamp buttons act on press.
- Each control takes its own pointer, so wheel and lever can be used with two thumbs at once.

### Views

The key legend in the drive lists the view keys that apply to the current screen.

- Top view: "Follow" (camera follows the vehicle) and "Whole yard". Switch with F / Y, or with the view buttons. The "Mirrors only" setting removes the top view.
- Cockpit view with mirrors. At graphics quality High, Q / E hold a glance to the side and dragging in the cockpit pane turns the head.
- "Outside view" (O): a chase view, offered at graphics quality Balanced and High, not Low. It orbits with `,` / `.` or by dragging and tilts with PgUp / PgDn.
- Zoom: + / - keys, mouse wheel or pinch over the top view. Pan: drag in the top view. 0 or L resets the view and size ("Reset view / size").
- The divider between top view and cockpit can be dragged; the share is kept per screen orientation.
- Aids: "Angle display" (with the Angles panel), "Predicted path", "Wheel tracks", "Target ghost"; each toggles in the Aids panel. The last three draw in the top view only, and a mirrors-only drive has no aids. A run with any aid on after the first driving input counts as "with aids".

## Exercises

The menu lists the exercises, each with a brief, a tolerance (position and angle) and a best result:

- Straight reverse
- Reverse into a bay
- Reverse around a corner
- Dock at a ramp
- Slalom forward and back

Stop inside the marked bay within tolerance to reach the target; a vehicle still moving does not count. The result shows position error, angle error, contacts, limit stops, direction changes and time, and offers Retry, Replay and Next exercise. Bests are kept separately with and without aids.

"Free yard" drives in the Depot or Logistics yard without a target or score. "Replay last run" replays the last drive you finished.

## Settings

In the menu:

- Truck, Trailer: the vehicle pair. Some dimensions are estimates, see [vehicle data](vehicle-data.md).
- Time of day: Day or Night. Night turns the lights on at the start.
- Driving view: "With top view" or "Mirrors only".
- Language: Deutsch or English. Until chosen, it follows the browser language.
- Theme: System, Light or Dark.
- Graphics quality: Low, Balanced or High.
- Wide-angle mirrors: On or Off.

Aids, the Follow / Whole yard choice, panel collapse state and the divider position are changed in the drive and kept as settings too. Lighting and driving view are part of the best-result key, so each combination has its own best.

## URL parameters

- `?backend=webgl2|webgpu|auto`: graphics API; the default and fallbacks are in [Graphics backend](perf.md#graphics-backend).
- `?perf=1`: performance overlay (fps, frame time, resolution scale, draw calls). See [perf.md](perf.md).
- `?framing=1`: development hook for tests; a drive publishes the drawn vehicle's screen box as `data-vehicle-box` on its container.
- `?probe`: development page that renders a circling vehicle instead of the app (`?truck=<id>&trailer=<id>&fold=left|right|straight`). Used by `pnpm test:perf`.

Unknown values fall back to the defaults.

## Browser storage

Choices and results are kept in the browser's `localStorage`. There are no accounts and the app sends no data anywhere. If storage is blocked or full, they last only for the session. The offline cache holds the app's own files only.

- `gegenlenker.settings.v1`: the settings above. A malformed value falls back field by field.
- `gegenlenker.best.v2`: best results per exercise, vehicle pair, aid use, lighting and driving view. Entries driven on vehicle or exercise data that has since changed are dropped.
- `gegenlenker.lastRun.v1`: the input log of the last drive, for replay. Dropped when the data it was driven on changed.
- `gegenlenker.whatsNewSeen.v1`: which "What's new" entries were opened, for the "New" badge.

The app also asks the browser to keep its storage persistent, so stored runs survive storage pressure; the browser may refuse.

Clearing the site data in the browser removes all of it.
