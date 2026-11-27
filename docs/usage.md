# User guide

Gegenlenker is a trainer for maneuvering a truck with a turntable drawbar trailer. Labels below are the English UI text; the app also runs in German.

## Open and install

- Open https://docgerd.github.io/gegenlenker/ in a current desktop or tablet browser. The graphics need WebGL 2; without it a drive does not start and the app shows a notice.
- The smallest supported window is 585 CSS px tall: what a 1080p laptop at 150 % display scaling leaves the page. In landscape it is at least 800 CSS px wide; portrait goes down to 600. Phones are not supported.
- After the first visit the app caches itself, and the menu footer shows "Ready offline". It then starts without a connection. Assets that only some graphics presets draw are downloaded for the chosen graphics quality while online, so choosing a higher one needs a connection once; until they are cached the footer says so instead.
- When a new version is available the app offers "Reload" or "Later".
- Installing it as an app uses the browser's own install action (for example "Install" in the address bar, or "Add to Home screen" on a tablet).
- The browser back action (Android back gesture) acts on the current drive, replay or result screen instead of leaving the app; in a drive it opens or closes the pause sheet.
- "About" on the title shows the version, the app's licence, the licences of the bundled libraries and the sources of the textures and sky, with links to the source code and the asset pages. The texts are part of the app, so it also opens offline; only the links need a connection.

## Controls

A drive has a steering wheel, a gear selector (P, R, N, D), a speed lever, a Stop button and two lamp buttons (lights, hazard lights). Select R or D to move; R drives backward. The lever sets a share of the speed cap and the gear sets the direction.

The menu's Controls screen, opened from the title or from Settings, lists the drive keys for the saved graphics quality and driving view, and the touch and mouse controls.

### Keyboard

- A / D or Left / Right: steer left / right. Hold to keep turning.
- C: centre the steering.
- W / S or Up / Down: raise / lower the speed lever by a step; hold to ramp.
- Space: brake (zeroes the lever; hold to keep braking).
- 1 / 2 / 3 / 4: gear P / R / N / D.
- H / X: lights / hazard lights.
- U: uncouple (in "Couple and uncouple", standing still).
- Esc: pause, and close the pause sheet again. The sheet offers Continue and Restart; in an exercise also "Finish" and "Leave without scoring", in the free yard "Menu"; always Settings, which Esc or back leaves for the actions again. The Pause button in the drive opens it too.

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
- "Free camera" (K from any view, or the camera button at the bottom of the outside view, which a very small window leaves out): flies the camera anywhere over the yard, up to 60 m high, while the truck keeps driving; the driving keys stay as they are. Drag to look, Shift-drag to slide, the wheel flies along the view. Hold `,` / `.` to turn, PgUp / PgDn to pitch and + / - to fly. On a touchscreen one finger looks, two fingers slide and, by pinching, fly. K again returns to the orbit as it was; 0 resets the orbit.
- Zoom: + / - keys, mouse wheel or pinch over the top view. Pan: drag in the top view. 0 or L resets the view and size ("Reset view / size").
- The divider between top view and cockpit can be dragged; the share is kept per screen orientation.
- Aids: "Angle display" (with the Angles panel), "Predicted path", "Wheel tracks", "Target ghost"; each toggles in the Aids panel. The last three draw in the top view only, and a mirrors-only drive has no aids. A run with any aid on after the first driving input counts as "with aids".

## Exercises

The menu opens on a title screen with Exercises, Free yard, Settings, Controls, What's new and About, plus "Continue" once there is a last exercise or yard and "Replay last run" once a drive has finished. Back or Esc returns one level.

"Exercises" lists the exercises, each with a short brief:

- Straight reverse
- Reverse into a bay
- Reverse around a corner
- Couple and uncouple
- Dock at a ramp
- Slalom forward and back

Choosing an exercise opens its setup: the brief, the tolerance (position and angle) and the best result for the chosen vehicles, time of day and driving view, then Truck, Trailer, Time of day, Driving view and "Start".

Stop inside the marked bay within tolerance to reach the target; a vehicle still moving does not count. The result shows position error, angle error, contacts, limit stops, direction changes and time, and offers Retry, Replay and Next exercise. Bests are kept separately with and without aids.

"Couple and uncouple" starts the truck solo in front of a parked trailer, with the drawbar in line. Reverse onto the drawbar eye: the coupling closes by itself when the jaw meets the eye within its catch (`jaw` in [vehicle data](vehicle-data.md)) and stops the truck; a miss runs the truck into the drawbar, a contact. Pull the trailer forward into the marked bay, stop, uncouple with U or the Uncouple button on the exercise card (it acts only at a standstill), and drive away from the trailer. The run ends at the next stop with the trailer within tolerance. The card says whether the truck is coupled, and the result adds the coupling speed against its limit. The exercise always takes a trailer, even with "No trailer" chosen, and has no Einweiser variant yet.

"Free yard" lists the Depot and the Logistics yard, which open the same setup and drive without a target or score. "Replay last run" replays the last drive you finished.

"Continue" tops the title once you have started a drive. It starts at once, with the stored truck, trailer, time of day and driving view, all named on the button. It picks the exercise you last drove while it is open, else the next exercise not done after it (wrapping), else the last one again; a free yard continues as that yard. The exercise and yard lists open on the same entry.

## Settings

On the setup screen of an exercise or yard:

- Truck, Trailer: the vehicle pair. "No trailer" drives the truck solo in every exercise but "Couple and uncouple", and in every yard: the target takes the truck's rear end, the ghost shows the truck, and neither the angle display nor limit stops are shown. An exercise is done solo and with a trailer separately; the lists and Continue follow the current choice. The Einweiser always guides a truck with its trailer: with "No trailer" chosen, his runs take the last trailer chosen. Some dimensions are estimates, see [vehicle data](vehicle-data.md).
- Time of day: Day or Night. Night turns the lights on at the start.
- Driving view: "With top view" or "Mirrors only".

Under "Settings" on the title, in the groups General and Graphics:

- Language: Deutsch or English. Until chosen, it follows the browser language.
- Theme: System, Light or Dark.
- Graphics quality: Low, Balanced or High.
- Wide-angle mirrors: On or Off.

The Settings screen also has a Controls row, and the title has a Controls entry: both open the Controls screen.

Aids, the Follow / Whole yard choice, panel collapse state and the divider position are changed in the drive and kept as settings too. Lighting and driving view are part of the best-result key, so each combination has its own best.

During a drive, Settings in the pause sheet offers Theme, Wide-angle mirrors and Graphics quality, which all apply at once, without restarting the run.

## URL parameters

- `?backend=webgl2|webgpu|auto`: graphics API; the default and fallbacks are in [Graphics backend](perf.md#graphics-backend).
- `?perf=1`: performance overlay (fps, frame time, resolution scale, draw calls). See [perf.md](perf.md).
- `?framing=1`: development hook for tests; a drive publishes the drawn vehicle's screen box as `data-vehicle-box` on its container.
- `?probe`: development page that renders a circling vehicle instead of the app (`?truck=<id>&trailer=<id>&fold=left|right|straight`). Used by `pnpm test:perf`.

Unknown values fall back to the defaults.

## Browser storage

Choices and results are kept in the browser's `localStorage`. There are no accounts and the app sends no data anywhere. If storage is blocked or full, they last only for the session. The offline cache holds the app's own files only.

- `gegenlenker.settings.v1`: the settings above and the entry of the last drive started, which Continue offers. A malformed value falls back field by field.
- `gegenlenker.best.v2`: best results per exercise, vehicle pair (or truck solo), aid use, lighting and driving view. Entries driven on vehicle or exercise data that has since changed are dropped.
- `gegenlenker.lastRun.v1`: the input log of the last drive, for replay. Dropped when the data it was driven on changed.
- `gegenlenker.whatsNewSeen.v1`: which "What's new" entries were opened, for the "New" badge.

The app also asks the browser to keep its storage persistent, so stored runs survive storage pressure; the browser may refuse.

Clearing the site data in the browser removes all of it.
