# Einweiser mode — spike design (#443)

The trainee stands outside the combination as Einweiser and gives the BG hand signs; an AI driver executes them. This document answers the nine questions of #443. No code.

"Decided (owner)" = stated by the owner. "Call" = proposed here, open to correction; the open ones are listed at the end. "Estimate" = a number not measured or sourced. Code references name the module and symbol.

## Source

The issue cites ASR A1.3 Anhang 1; the hand signs are **ASR A1.3 Anhang 2 "Handzeichen"** (Anhang 1 is the Sicherheitszeichen); the rules are in Nr. 5.7. The vehicle signs are also DGUV Vorschrift 70 Anhang 4 "Handsignale für Einweiser von Fahrzeugen", with identical wording.

- Decided (owner): exactly the nine vehicle signs of DGUV V70 Anhang 4. No Langsam, Heben or Senken (crane signs, not in V70), no invented end sign.
- Decided (owner): signs are read in the Einweiser's frame. Herkommen = the vehicle moves toward the Einweiser, forward or in reverse depending on where he stands; Entfernen = away from him; Rechts/Links fahren = toward his own right/left ("vom Einweiser aus gesehen", ASR wording).
- Rules the trainer enforces: the Einweiser stays in the driver's field of view and never between the moving vehicle and obstacles in its path; the driver stops at once when he loses sight of the Einweiser (DGUV V70 §46(2) and its DA; BG Verkehr G2 "sofort anhalten!"). Einweiser should not walk backwards (BG G2, DLRG). ASR A1.3 and DGUV V70 give no numeric safety distance; the BG E5 diagram shows about 3 m, and DLRG names "mind. 50 cm" (its reference ambiguous).

## 1. Signal vocabulary

| Key | Sign                 | Pose (ASR A1.3 Anhang 2, abridged)                                                        | Motion | Driver intent (Einweiser frame)                                      |
| --- | -------------------- | ----------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| 1   | Achtung              | right arm up, palm forward (alias "Anfang, Vorsicht")                                     | static | opens the Einweisung; the driver attends and holds the brake         |
| 2   | Halt                 | both arms out sideways, horizontal, palms forward                                         | static | lever to 0, brake at standstill                                      |
| 3   | Halt – Gefahr        | as Halt, arms alternately bent and stretched                                              | loop   | brake at once                                                        |
| 4   | Abfahren             | right arm up, palm forward, arm moved sideways to and fro                                 | loop   | Call: move off forward at creep, whatever the Einweiser's position   |
| 5   | Herkommen            | both arms bent, palms inward, forearms beckon                                             | loop   | move toward the Einweiser at creep, leading end straight             |
| 6   | Entfernen            | both arms bent, palms outward, forearms wave away                                         | loop   | move away from the Einweiser at creep, leading end straight          |
| 7   | Rechts fahren        | right arm horizontal, slightly bent, moved sideways to and fro                            | loop   | leading end curves toward the Einweiser's right; direction unchanged |
| 8   | Links fahren         | as 7, left arm                                                                            | loop   | leading end curves toward the Einweiser's left                       |
| 9   | Abstandsverringerung | palms parallel, brought together with the distance ("Anzeige einer Abstandsverringerung") | loop   | crawl in the current direction                                       |
| 0   | (no sign)            | arms down                                                                                 | —      | as Halt: motion needs a sign in view                                 |

- The leading end is `Prediction.lead` (`src/contracts/sim.ts`): the trailer rear in reverse, the truck front forward.
- Bindings: `KeyboardEvent.code` `Digit1`–`Digit9` and `Numpad1`–`Numpad9`, `Digit0`/`Numpad0` for no sign. Call: alternates `Space` = Halt (same key as the driver's Stopp) and `KeyQ`/`KeyE` = Links/Rechts fahren (spatial, under the left hand, free once mouse look replaces the Q/E glance). Signalling while standing still is the taught practice, so the left hand may leave WASD for 6–9.
- Call: signs latch. A key starts its sign, which loops until another sign key or 0. A new key cuts over at once with a short blend (0.15 s, estimate): no queue, so Halt never waits for a cycle to end. The same key again does nothing.
- The name and a pictogram of the source pose (front view, as the driver sees it) show in the sign bar while the sign plays: the first-person view cannot show the whole sign (§3.3), so the pictogram teaches what it looks like. The pictograms are drawn from the pose table, not copied from the ASR.
- Legend: a sign bar of ten slots (key, name, pictogram; the active one marked) in the band at the bottom of the view; walk, look, jog and pause keys in the key legend. New `Scope`s `'walk'` and `'sign'` in `src/input/keymap.ts`, with rows in `KEYMAP` (table order = legend order; `keymap.test.ts` and `legend.test.ts` extend).

## 2. Driver model

An AI `ControlSource` emits one `ControlVector` per sim step. It only steps targets: the sim already rate-limits steer (`steerRate`) and ramps speed to `lever × V_MAX` with `ACCEL`/`DECEL`/`BRAKE_DECEL` (`nextSpeed`, `src/sim/simulation.ts`), so the change-only input log stays sparse.

Per step the driver reads the held Einweiser pose, the active sign and the sight result (§3.5), and keeps a FIFO of what it perceived, so it acts on each perception after a fixed delay.

### Unaided vs. on a sign (call)

- Unaided: it keeps the articulation stable (rejects any steer that predicts a limit stop), holds speed to the sign's lever, stops on Halt, no sign or lost sight, and brakes as for Halt – Gefahr when the Einweiser is visible inside its predicted swept path within stopping distance plus 1 m (estimate).
- Never: it does not know the target, does not avoid static obstacles and never picks a direction itself. So contacts, target error and direction changes come from the trainee's signs. It does brake for a visible Einweiser in its path, as a driver would for a person; a run-over stays possible when he steps in within stopping distance or stands in the path unseen.

### Einweiser frame

- Gear for Herkommen: R when the Einweiser is nearer the trailer-rear centre than the truck-front centre, else D; Entfernen takes the other. When the nearer distance exceeds 0.8 of the farther (he stands abeam the middle of the combination, estimate), the sign is unclear: the driver waits.
- The gear is chosen when the sign is recognised and latched while it plays, so walking while signalling does not flip it. A gear change stops first (lever 0, brake), shifts at standstill, then moves; the sim counts it in `directionChanges`.
- Rechts/Links: the indicated world direction is the Einweiser's heading −90° (right) or +90° (left) (sim plane: counter-clockwise positive), from the held pose at recognition. Its side relative to the leading end's direction of motion is the steer goal.
- Worked cases (straight combination): behind a reversing combination, facing it, the Einweiser faces the truck's heading, so his right is the driver's right. In front of a truck driving forward, facing it, his right is the driver's left: the driver mirrors.

### Steering: a planner, not a sign→steer table

With a turntable drawbar trailer in reverse, the trailer rear first goes the way the wheel is turned (double inversion; `src/sim/simulation.test.ts` pins it per vehicle pair), and its later response depends on the articulation state, so no fixed steer sign means "rear to the right". The driver does not encode it:

- Every 15 steps (0.25 s, estimate) it calls `predictCombination` (`src/sim/predict.ts`) for nine candidate steers −1…1 over 3 m (estimate), with a pivot-only `ContactQuery` (`() => null`), so only limit stops block.
- Cost = |predicted leading-end heading change − goal|; goal 0 for straight, ±3 m / 15 m for Rechts/Links (curve radius 15 m, estimate). Blocked candidates are dropped. It keeps the current steer unless another candidate beats it by a margin (hysteresis), so the steer changes rarely.
- The heading comes from the midpoints of `Prediction.left`/`right`. The prediction already ramps the road wheels at the sim's rate.
- `predict.ts` becomes a gameplay input for this mode, not just display (CLAUDE.md calls it display-only): changes to it move Einweiser behaviour, hence `EINWEISER_REVISION` (§5).
- Fallback if the gate test (§9) shows the planner cannot hold a reverse: a cascade controller (goal trailer heading → turntable angle → coupling angle → steer).

### Speeds and timing (calls; numbers from `src/sim/constants.ts`)

| Item                                                        | Value                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Creep lever (Herkommen, Entfernen, Rechts/Links, Abfahren)  | 0.5 → 0.69 m/s (`V_MAX` = 5 km/h)                                                                                  |
| Crawl lever (Abstandsverringerung)                          | 0.15 → 0.21 m/s                                                                                                    |
| Reaction `T_r` (all signs, lost sight)                      | 0.7 s, estimate: no reaction-time source in this spike; tuned in the gate PR                                       |
| Recognition of a looping sign                               | `T_r` + 0.5 s (half a cycle, estimate); static signs at `T_r`; Halt – Gefahr at `T_r` (it starts in the Halt pose) |
| Stop from creep, Halt (`DECEL`)                             | 0.49 m + 0.30 m = 0.79 m                                                                                           |
| Stop from creep, Halt – Gefahr / lost sight (`BRAKE_DECEL`) | 0.49 m + 0.10 m = 0.58 m                                                                                           |
| Stop from crawl, Halt                                       | 0.15 m + 0.03 m = 0.17 m                                                                                           |
| Stop from `V_MAX`, brake                                    | 0.97 m + 0.39 m = 1.36 m                                                                                           |

Stopping distance = `v·T_r + v²/(2·a)`. A walking Einweiser (1.4 m/s, §3.1) matches `V_MAX`, so at creep he keeps pace without jogging.

A sign shown for less than its recognition time is never acted on.

### Misinterpretation (deterministic)

Only objectively ambiguous signs are misread, as pure functions of pose, facing and timing; no `Math.random` (banned in core lint), no seed.

- Abeam (above): Herkommen/Entfernen unclear, the driver waits.
- Facing, measured between the Einweiser's heading and the line from him to where he is seen (the eye, or the mirror mount):
  - within 60°: read as given;
  - 60°–120° (side-on): direction signs unclear, the driver waits;
  - beyond 120° (back turned): Rechts↔Links and Herkommen↔Entfernen read swapped, since from behind the arm shows on the other side and beckoning looks like waving away;
  - Achtung, Halt and Halt – Gefahr are always read.
- Out of sight or too short: ignored (scored, §4).
- Later option: a seeded "noisy driver" with the seed in the log; not in the MVP.

### Lost sight

- Sources say stop at once. Call: the stop starts after `T_r`, the time to notice, with no extra grace, then brakes (`BRAKE_DECEL`): 0.58 m from creep, well inside the ~3 m spacing the BG E5 diagram shows.
- If sight returns before `T_r`, the timer resets, so a pillar or a mirror edge does not stop the vehicle.
- After a stop the driver moves again only once it re-recognises a movement sign in sight (full recognition time). This matches the UKH rule: stop first, the Einweiser repositions, then signals again.

## 3. Einweiser view and body

### 3.1 Walking and look

- `src/einweiser/walk.ts` (pure): `walkStep(pose, held, dt, colliders) → pose`.
  - WASD in the facing frame (`KeyboardEvent.code`, same physical keys on QWERTZ/AZERTY); arrows as alternates; Shift jogs.
  - Walk 1.4 m/s (Weidmann mean 1.34 m/s), jog 3.0 m/s (estimate), 0.2 s acceleration ramp (estimate).
  - A 0.25 m circle (estimate) slides along obstacle OBBs and the combination's bodies, clamped to the yard.
- Look (`src/input/pointer-lock.ts`, `src/input/walk-input.ts`):
  - `canvas.requestPointerLock({ unadjustedMovement: true })` on a click; on `NotSupportedError` (Chrome on Linux) retry without options; guard the non-promise return.
  - State comes from `pointerlockchange`/`pointerlockerror`. Losing the lock (Esc, blur, tab switch) opens the pause sheet; resuming takes a click (no auto re-lock; browsers refuse quick re-locks). The sim already freezes while the sheet is open (`advanceClock`, `src/app/drive.ts`).
  - The first `mousemove` after lock is dropped, single deltas above 300 px (estimate) are clamped, deltas are summed per frame and ignored while unlocked.
  - Yaw/pitch at 0.15°/px (estimate), pitch clamped to ±85°, no roll, no smoothing, no head bob, no FOV kick.
- Settings (call): choice rows "Mausempfindlichkeit" (Niedrig/Mittel/Hoch = 0.08/0.15/0.3°/px, estimates) and "Maus invertieren" (Aus default/An). FOV and head bob are not offered in the MVP.
- Rebinding: not offered (a non-goal of the menu spec). Bindings are by `code` with alternates; a later rebind UI refuses Ctrl/Alt/Meta combos, since `Keyboard.lock` is limited and the browser keeps Ctrl+W/T/N.
- Conflicts: WASD, arrows, digits, Space and Q/E are drive or view keys today. Einweiser mode mounts no driver keyboard, wheel or lever (`createControls`). `'sign'` and `'walk'` take precedence over `'view'`: on Dvorak `KeyS` types "o" (`viewChase`), and `0` is the view's `resetView` by `key`. Ctrl/Alt/Meta stay unbound (`createKeyboard` already ignores them).

### 3.2 Camera

- First-person camera at the held pose, eye height 1.60 m (estimate; DIN 33402-2 is paywalled).
- Vertical FOV fixed at 59° (Hor+, 90° horizontal at 16:9); three's `fov` is vertical.
- Layers `EINWEISER_LAYERS = [PERSPECTIVE_LAYER, CAB_LAYER]` (`src/render/seams.ts`): he sees the cab exterior, the sky dome and the skyline, not `INTERIOR_LAYER`. Far plane `CAMERA_FAR`.
- Call: no preset flag. CLAUDE.md's flag rule is for realism layers; the view and arms are the mode itself, and the mode draws no driver mirrors (§7), so it costs fewer passes than driver mode on every preset, Low included.

### 3.3 Arms (view model)

- Rig: rigid segments per arm (upper arm, forearm, hand; hi-vis sleeve with a reflective band per ASR 5.7(3)). Procedural geometry in `src/render/einweiser-arms.ts`; no Blender, no skinning.
- Pose table: joint-angle keyframes per sign in a three-free `src/render/sign-poses.ts`, slerped and looped. The table also drives the pictograms and the later avatar.
- Framing (call): Halt's arms point straight sideways and Achtung's straight up, outside any usable FOV. The view model uses first-person versions of the poses (hands at about ±30° azimuth, raised arm forward-up), while the pictogram and avatar keep the source poses (Unreal's split of first-person and world representation). One-arm signs (Achtung, Abfahren, Rechts/Links fahren) show the idle arm lowered with its hand at the lower frame edge, so both arms stay in frame.
  - A unit test projects every sign's keyframe hand and forearm points through the view-model camera at the narrowest supported aspect and asserts them in frame and above the band, so "both arms in frame for every sign" is pinned like `cockpit-interior.test.ts`.
- Pass:
  - Same scene, new `VIEWMODEL_LAYER = 7` (the next free layer), its own camera with a fixed 60° vertical FOV (estimate, Bevy's pattern), and a view offset that frames the arms above the band.
  - It renders right after the first-person pass with a depth-only clear: `autoClearColor = false`, `autoClearDepth = true`, folding the clear into the pass. An explicit `clear()` costs an extra multisample resolve on WebGL 2 (comment in `src/render/three-renderer.ts`). On WebGPU the in-pass clear is a load op that ignores the scissor, which for depth only leaves earlier panes' colour intact.
- Pitfalls:
  - `scene.background` is unset (the sky is a dome on `PERSPECTIVE_LAYER`), so the second pass draws no backdrop.
  - The arms use an unlit node material whose colour scales with a look uniform (day/night): no light change (changing the light set recompiles every program), no shadow sampler (High-night is near the 16-sampler limit), `castShadow` off, layer 7 kept out of `SHADOW_CASTER_LAYERS`.
  - Lights routed through `prepareShadow` (`src/render/sun-shadow.ts`) render their map once per queued frame on explicit layers. Verify for every shadow-casting light that the extra camera triggers no second shadow render (`drawCalls` in `e2e/draw-budget.spec.ts`).

### 3.4 Body in the world

- Top-down: an Einweiser token (disc plus facing wedge) on `AIDS_LAYER` in a scene token colour (T1–T4 contrast, `tokens.test.ts`), the same on every preset.
- Perspective avatar (same pose table, source poses) on a new `AVATAR_LAYER = 8`, seen by chase and mirror cameras but not by his own first-person camera. Needed only for the replay outside view and the later phase, so it ships after the MVP.
- `RenderFrame.einweiser?: { pose, sign, phase }` (`src/contracts/render.ts`), updated like the vehicle visual.

### 3.5 Line of sight (pure core)

There is no mirror plane in code: a mirror is a camera at a mount with yaw, pitch, roll, vertical FOV and aspect (`MirrorSpec`, `src/render/mirror.ts`; `CLASS_V`, `src/render/close-mirror.ts`). The core check uses the same model, so the AI sees what the driver's mirror views would show.

`sightOf(geometry, snapshot, points, occluders) → { direct: boolean; mirrors: readonly MirrorId[] }` in `src/einweiser/sight.ts`:

- Points: the Einweiser's head (1.60 m) and chest (1.30 m), estimates, at the held pose. Visible = any point seen directly or in any mirror.
- Direct: the ray from the eye (`truckAnchors(spec).eye`, world via `snapshot.truck`) leaves through glass. That means the windscreen minus the A-pillars (`cabSight`, `src/render/cab-sight.ts`) or a side window (`TruckSpec.cab` `sideGlassSetback`/`sideGlassLength`), between the glass sill and top (`FRAME_TOP` + `glassSill` … + `glassHeight`), and the segment is clear of occluders.
- Mirror: the point lies in the mirror camera's frustum (horizontal half-angle `atan(aspect·tan(fov/2))`), and the mount → point segment is clear of occluders. The eye → mirror line is taken as clear; `cockpit-interior.test.ts` pins the pillars off those lines.
- Occluders: 2.5D boxes, i.e. the resolved layout's obstacles (`Obb` + `height`) and the combination's bodies (`bodyFootprints`, `src/sim/geometry.ts`, plus body heights). Clip the segment's ground projection to the OBB (slab test); it is blocked if the segment's height at either clip end is below the box height. Exact for boxes, cheap.
- Fixed inputs: the full mirror set the trucks carry (II left/right, IV left/right, V, VI), whatever the preset, the wide-angle mirrors setting or the window. Class II gets a fixed aspect (0.56, the glass in `tools/blender/cab_shell.py` `GLASS.main`; today it follows the layout rect). So the gameplay result never depends on graphics.
- Moves from render to `src/vehicles/` (render re-exports): mirror optics (`CLASS_II_YAW`, `WIDE_YAW`, the class II/IV/V/VI specs' numbers, `WIDE_ASPECT`, `FRONT_ASPECT`, `CLOSE_ASPECT`), `frontMirrorMount`/`closeMirrorMount` (`src/render/mirror-fields.ts`), `cabSight` and the cab dims it reads (`FRAME_TOP`, `CAB_HEIGHT`, the `cabShellParams` subset), and body heights (`SWAP_BODY_HEIGHT` and deck heights, `src/render/trailer-dims.ts`). They are three-free but under `src/render`, which core may not import.
  - All stay outside `VehicleParams`, as the mirror mounts are, so `dataFingerprint` and the `run.test.ts` digests do not move.
- Reversibility of light paths: a mirror that shows the Einweiser to the driver's eye shows the driver's eye to the Einweiser. So the same result is the eye-contact truth for both, and later real reflections only show it.

### 3.6 Sight cue (MVP)

A HUD cue beside the sign name: an eye icon and text, never colour alone.

| State   | Text                                                                |
| ------- | ------------------------------------------------------------------- |
| direct  | "Sichtkontakt"                                                      |
| mirror  | "Sichtkontakt im Spiegel links/rechts/…"                            |
| none    | "Kein Sichtkontakt"                                                 |
| unclear | "Zeichen unklar", briefly, when the driver waits on an unclear sign |

### 3.7 Layout

- `computeViewports` (`src/render/viewports.ts`) gets an Einweiser mode: the cockpit rect becomes the first-person view, with no mirror rects or extras, no controls (`controlsHeight` 0) and no sight cone (`CLEAR_CONE_DEG` is the cockpit's).
- Call: the top view stays optional through the existing no-pane flag. `mirrorsOnly` (log, best key) means "no top-down pane" (`hasTopDown()`), labelled "Mit Draufsicht / Ohne Draufsicht" for this role; aids are off without the pane, as today.
- The band (`.hud-band`) holds the sign bar. The sign name and sight cue sit top-left of the view.
- `messageColumn` gets an Einweiser branch: top-centre of the view, clear of the cue and the band, with or without the pane. `messagesFit` and `expectMessagesClear` cover it at every `e2e/layout.spec.ts` size, and `pnpm verify:layout` runs per the `verify-viewport-layout` skill.
- The HUD's `pedalsBox` becomes optional (no pedals in this mode).

## 4. Scoring

`src/scoring/einweiser.ts`, a per-step tracker beside `createRunTracker`:

| Result / fault            | Rule                                                                                                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| run over (fail, run ends) | a person box (0.5 × 0.3 m, estimate) at the held pose hits a body (`createContactQuery([person])(bodyFootprints(…))`, counting only results with the person's `obstacleId`, since the query also reports truck against trailer) while the vehicle moves faster than `STOPPED_SPEED` |
| `inPath`                  | while moving, the person lies inside the swept footprints of every body over stopping distance + 1 m (§46(2))                                                                                                                                                                       |
| `tooClose`                | while moving, clearance to any body < 0.5 m (DLRG minimum, estimate)                                                                                                                                                                                                                |
| `outOfSight`              | sight lost while moving; repositioning while the vehicle stands is allowed (UKH)                                                                                                                                                                                                    |
| `signOutOfSight`          | a sign change made while not in sight                                                                                                                                                                                                                                               |
| `unclear`                 | a direction sign the driver could not read (abeam, side-on)                                                                                                                                                                                                                         |
| `lateHalt`                | an obstacle contact while a movement sign showed and `contactAhead` (real contact query) had been true for longer than `T_r`                                                                                                                                                        |
| `walkedBackwards`         | walking against the facing faster than 0.3 m/s (estimate) while the vehicle moves (BG G2, DLRG)                                                                                                                                                                                     |
| `noAchtung`               | a movement sign before the first Achtung (counted once; the driver ignores it)                                                                                                                                                                                                      |

- Swept footprints: `predict.ts` returns only the leading end's corner pair, and a reversing truck's front swings out. So `inPath` needs a pure `sweptBodies(params, from, distance)` beside `predictCombination` (same integrator).
- Every fault counts once per incident, the way `contacts` count once per incident key.
- `RunResult` (`src/contracts/exercise.ts`) is reused whole: `reached`, `positionError`, `angleError`, `contacts`, `jackknifes`, `directionChanges`, `time` and `assisted` keep their meaning. It gains an optional `einweiser?: { runOver: boolean; faults: Readonly<Record<EinweiserFault, number>> }`; driver results serialise unchanged. A run-over ends the run at once with `reached: false`.
- Call: no Einweiser bests in the MVP (the owner cares little about bests); the result screen lists the faults, and `src/scoring/debrief.ts` adds one line per fault kind with its rule (e.g. §46(2)). Later bests rank apart under a `/einweiser` key suffix, a run-over is never stored, and faults join `contacts + jackknifes` in `compareResults`.

## 5. Determinism, replay, fingerprint, layering

Decided (owner): the AI driver's `ControlVector`s are logged and authoritative (replay works as today), plus an Einweiser track (pose and signs) for display; AI changes do not invalidate stored runs.

- Held pose:
  - The core never sees the live camera pose. Every 6 steps (10 Hz, estimate) the app samples it, quantises it (1 cm, 1 mrad) and holds it until the next sample.
  - The driver, the sight check and the fault tracker read only the held pose, so live and replay see the same numbers. The hold lags the live pose by up to 14 cm walking (30 cm jogging); the person box is sized with that margin.
  - Pitch rides along for the replay's first-person view only.
- Log v4 (`InputLog`, `src/contracts/exercise.ts`; `src/sim/replay.ts`):

  ```ts
  type SignId =
    | 'achtung'
    | 'halt'
    | 'haltGefahr'
    | 'abfahren'
    | 'herkommen'
    | 'entfernen'
    | 'rechts'
    | 'links'
    | 'abstand';
  type EinweiserSample = {
    readonly step: number;
    readonly x: number;
    readonly y: number;
    readonly heading: number;
    readonly pitch: number;
  };
  type EinweiserTrack = {
    readonly samples: readonly EinweiserSample[]; // change-only
    readonly signs: readonly { readonly step: number; readonly sign: SignId | null }[];
  };
  type InputLog = {
    readonly version: 4;
    readonly role: 'driver' | 'einweiser';
    readonly einweiser?: EinweiserTrack;
    // …the v3 fields, unchanged
  };
  ```

  - `parseInputLog` accepts v1–v4, with role `'driver'` when absent. `replaySnapshots` and `createReplayCursor` are unchanged.
  - The track adds at most one sample per 6 steps, ≤ 12 000 per `MAX_REPLAY_STEPS` run; an estimated few hundred kB worst case, far less while the trainee stands to signal. `storeLastRun` already drops a log whose write fails.

- Derived, not stored: sight states, faults and replay events are recomputed from snapshots plus track (pure, exact on the held pose). Call: one source of truth, guarded by a revision, like driver runs.
- Fingerprint:
  - The sim is untouched. The person is not in the sim's `ContactQuery`: the hit ends the run, so the sim need not block for it, and a controls-only replay cannot diverge. So `SIM_REVISION` does not move.
  - `dataFingerprint` is unchanged. Einweiser runs pass `scoring: { ...SCORING_THRESHOLDS, ...EINWEISER_THRESHOLDS, EINWEISER_REVISION }` and `RunIds` gains `role`, so driver runs keep their fingerprints and `run.test.ts` digests (evidence the seam refactor is behaviour-neutral).
  - Shared reading rules feed both the driver and the derived faults: sight geometry, abeam ratio, facing bands, `T_r` (`lateHalt`) and the Achtung rule. They live in `src/einweiser/signs.ts` and `sight.ts`, are hashed with `EINWEISER_THRESHOLDS`, and a change to them, to Einweiser scoring or to `predict.ts` bumps `EINWEISER_REVISION`. Driver-only tuning (planner candidates, horizon, cost and hysteresis, lever values, recognition time, the braking look-ahead) needs nothing. One pinned Einweiser digest per layout (a fixed v4 log) joins `run.test.ts`.
- Layering:
  - New core dir `src/einweiser/` (`signs.ts`, `sight.ts`, `walk.ts`, `driver.ts`, `track.ts`) and types in `src/contracts/einweiser.ts`. Add the dir to `CORE` in `eslint.config.js` and to `tsconfig.core.json` `include`, with rules: sim imports neither `einweiser` nor `scoring`, and `einweiser` does not import `scoring`.
  - Not in `src/sim`: the sim stays the vehicle model whose revision guards driver runs, and the driver is outside the replay contract.
  - `src/app/drive.ts`: extract `ControlSource { tick(dt, snapshot); control(); lamps() }`; `createControls` becomes the manual source and `createAiSource` wraps driver, walk and track. The fixed-step loop (`controls.tick` → `control()` → `recorder.record` → `sim.step` → tracker) keeps its order, with the track recorder and Einweiser tracker beside the existing ones.

## 6. Exercise reuse

- Every exercise and free yard runs unchanged: `ExerciseDefinition`, start, target, tolerances, waypoint and obstacles are reused as they are. The run still ends when the tracker reports `reached` (stopped inside tolerance, i.e. after Halt).
- The Einweiser's start pose is a pure function of the exercise start and the combination's dims. Call: rear left (driver's side) by default, 2 m behind and 1.5 m outboard of the trailer rear, estimate. It is set in the menu spec's `'position'` setup step ("Standort": hinten links / hinten rechts / vorn). It is not in `ExerciseDefinition`, so no driver-run fingerprint moves; the track's first sample logs it.
- Tightest: dock-ramp (0.3 m, 2°). The stop lands a fixed distance after Halt, so the trainee calls it early by that distance: 0.79 m from creep, 0.17 m from crawl. Crawl makes the tolerance forgiving of timing (0.1 s late costs 2 cm instead of 7 cm), which is what Abstandsverringerung is for.
- Slalom (forward, with a turn point) needs Herkommen from in front or Entfernen from behind; both follow from the Einweiser-frame rule.
- Whether every exercise leaves a standing point in sight and outside the swept path is answered by the gate test (§9).
- Menu (spec `docs/superpowers/specs/2026-11-25-main-menu-design.md`, "Role-ready"):
  - `Role` gains `'einweiser'`; catalogue entries reuse the exercise ids with their own title and brief keys.
  - Call: a separate title entry "Einweisen" opens the exercise list with that role, so the driver path keeps its activation count. It is shown only with `matchMedia('(pointer: fine)')` and pointer lock available (desktop-only, no dead entry on tablets).
  - `settings.ts` parses only `role: 'driver'` as the last entry today; it must accept `'einweiser'` so Continue resumes it.
  - The entry lands with the first playable PR (no entry that leads nowhere).

## 7. Later-phase cost

Today, from code reading, not measured:

- Up to 5 mirror scene passes per frame: class II ×2, class IV alternating ×1, VI ×1, V ×1 (`MIRRORS`, `src/render/mirror.ts`).
- Plus the cockpit pass, the pane pass, 6 composite quads, 1 output pass, and shadow passes (`e2e/draw-budget.spec.ts`).
- `DRAW_CALL_BUDGET` (`src/render/quality.ts`) is asserted at 1920×1080 with every mirror.

| Item                       | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Cost (estimates)                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP                        | first-person pass (replaces the cockpit), view-model pass, pane 0–1; no driver mirror passes, since the trainee does not see them                                                                                                                                                                                                                                                                                                                                               | arms ≤ 10 draw calls; fewer scene passes than driver mode on every preset                                                                                                                           |
| Transparent cab glass      | `<group>-glass` is already its own mesh in the cab glb, merged with the lenses only at load (`bake`, `src/render/glb-shells.ts`): stop merging it and give it a transparent material sorted after opaque; no glb rebuild unless the glass shape changes                                                                                                                                                                                                                         | +1–3 draw calls per pass that sees the cab                                                                                                                                                          |
| Interior and driver figure | the Blender interior (`interior_shell.py`) is authored in the truck frame and placed at the eye each frame (`src/render/interior-glb.ts`), on `INTERIOR_LAYER`, cockpit camera only, and drawn only where `cockpitInterior` and `interiorGlb` are on. Reuse it on a layer the first-person and chase cameras see; the flat overlay and the lit lip are NDC-authored and stay cockpit-only. Add a seat and a driver figure (cockpit camera excluded) with an `ATTACHMENTS` entry | +4 (interior meshes) and +5–10 (seat, figure) draw calls                                                                                                                                            |
| Reflecting mirrors         | one planar reflection pass per visible mirror, culled with the pure sight geometry (facing + frustum): typically 1–3, worst 6, each about one of today's mirror passes; convex class II/IV approximated by a widened FOV                                                                                                                                                                                                                                                        | comparable to driver mode's up to 5 mirror passes (worst case one more); reusing the driver-eye mirror targets as glass textures would be free but is right only from the driver's eye, so rejected |

- Gating: preset flags `cabGlass`, `cabInterior` and `mirrorReflections`, High first and off on Low. An Einweiser case in `e2e/draw-budget.spec.ts`, a probe view in `e2e/perf/four-views.perf.ts`, a real-GPU desktop run (`pnpm perf:tablet --throttle 1 --preset high`) and an owner device check.
- Effort: 4–6 PRs (estimate); Blender work for the seat and driver figure.

## 8. Best practices (sources)

Signs and Einweiser rules:

- ASR A1.3, Anhang 2, Nr. 3.15, 4(6), 4(8), 4(10), 4(12), 5.7: https://www.baua.de/DE/Angebote/Regelwerk/ASR/pdf/ASR-A1-3.pdf?__blob=publicationFile
- DGUV Vorschrift 70 §46, Anhang 4: https://bg-verkehr.de/medien/medienkatalog/unfallverhuetungsvorschriften/dguv-vorschrift-70/at_download/file ; §46 with DA: https://vorschriften.bgn-branchenwissen.de/daten/dguv/70/46.htm

Teaching. Sequence in the sources: duty and accident examples → agree the signs → practice at walking speed through a cone course (UKBW Übung 9) → yearly Unterweisung. The trainer mirrors it: debrief lines cite the rule, and exercises run at creep.

- BG Verkehr G2: https://bg-verkehr.de/medien/medienkatalog/unterweisungsmedien/unterweisungskarte-g2/at_download/file
- BG Verkehr E5: https://bg-verkehr.de/medien/medienkatalog/unterweisungsmedien/unterweisungskarte-e5/at_download/file
- DGUV Information 205-024: https://publikationen.dguv.de/widgets/pdf/download/article/2871
- UKH: https://www.ukh.de/fileadmin/Medien/Medien/Unternehmen_und_Besch%C3%A4ftigte/1-044_Moderationshinweise_Rueckwaertsfahrt.pdf
- UKBW Übung 9: https://download.kfv-oh.de/FahrBerVO/6%20LG%20Fahr%fcbungen/HFUK%20Fahr%fcbungen%20mit%20Einsatzfahrzeugen/Uebung_9_Rueckwaerts_fahren_mit_Einweiser.pdf
- UKRLP: https://www.ukrlp.de/fileadmin/ukrlp/daten/pdf/startseite_internetseite/service/flyer_broschueren/sicherheit_einsatzfahrten_01.pdf
- DRK: https://www.bildungsinstitut-rlp.drk.de/fileadmin/Download/Fachuebergreifende_Bild/F%C3%BChrerscheinerweiterung_KatS_Schulung.pdf
- DLRG: https://obere-hunte.dlrg.de/fileadmin/groups/8350120/Einsatz/Merkblaetter/20200523_MB-OBH-WRD-02_Einweiserzeichen.pdf
- HSE reversing: https://www.hse.gov.uk/workplacetransport/factsheets/reversing.htm ; checklist: https://www.hse.gov.uk/workplacetransport/checklist/section5.htm ; banksmen: https://www.hse.gov.uk/construction/faq-banksmen.htm

Sign-selection UX:

- No ground-vehicle marshalling sim was found.
- Aircraft-marshalling VR trainers split tutorial and assessment modes: https://cove.army.gov.au/article/innovating-army-aircraft-marshalling-training . The MVP is the tutorial (names and pictograms always shown); an assessment variant that hides them is a cheap follow-up.

FPS controls:

- Pointer lock: https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock ; https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API ; https://w3c.github.io/pointerlock/ ; movement spikes: https://bugzilla.mozilla.org/show_bug.cgi?id=1420445
- Physical keys: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code ; `Keyboard.lock` is limited, so no Ctrl combos: https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/lock
- Adjustable sensitivity and camera: https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/117 ; no camera motion beyond input: https://gameaccessibilityguidelines.com/avoid-or-provide-option-to-disable-any-difference-between-controller-movement-and-camera-movement/
- FOV and sickness: https://developer.valvesoftware.com/wiki/Fov ; sensitivity scale: https://aimlabs.com/articles/aimlabs/a-quick-explainer-on-cm-360-and-the-common-cm-360-by-game/
- Walk speed: https://www.pedbikeinfo.org/cms/downloads/Free%20Speed%20Distributions%20for%20Pedestrian%20Traffic.pdf ; https://www.physicaltherapy.utoronto.ca/sites/default/files/assets/files/11walking-speed-age-and-sex-specific-normative-values-final.pdf

View model:

- Two-camera, depth-cleared pass: https://discourse.threejs.org/t/rendering-a-gun-on-another-layer/80805 ; https://discourse.threejs.org/t/always-render-an-custom-mesh-on-top/47635
- Depth range is WebGPU-only, so not portable: https://threejs.org/docs/pages/Renderer.html
- Fixed view-model FOV: https://bevy.org/examples/camera/first-person-view-model/
- First-person vs. world representation: https://dev.epicgames.com/documentation/unreal-engine/first-person-rendering
- Skinned-mesh CPU cost, a reason for rigid segments: https://discourse.threejs.org/t/optimization-of-large-amounts-100-1000-of-skinned-meshes-cpu-bottlenecks/58196

## 9. Effort and MVP

MVP: first-person Einweiser with arms, nine signs, AI driver, line of sight with the HUD cue, scoring, log v4. Not in the MVP: the perspective avatar, the first-person replay, bests, and the later phase.

| PR  | Scope                                                                                                                                                                                                                                                                                                                                                                                         | Size |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Move mirror optics, mounts, cab sight and body heights to `src/vehicles/` (render re-exports; no visual change, checked by shot hashes); `src/einweiser/sight.ts`; `src/einweiser/` added to the core configs. Tests: rear left seen in the left class II; straight behind the trailer unseen; beside the cab seen directly; hidden by the trailer body when articulated                      | M    |
| 2   | **Gate.** `signs.ts`, `driver.ts` (planner, FIFO, gear rule, lost sight), and a test-only scripted Einweiser policy that reaches `reached` in every exercise × vehicle pair, dock-ramp included; tests for the sign semantics per pair (Herkommen behind reverses toward him; Rechts behind moves the trailer rear to his right; in front it mirrors; Halt and lost-sight stopping distances) | L    |
| 3   | `ControlSource` seam in `drive.ts`; log v4 parse/serialise; `RunIds.role`; driver digests unchanged                                                                                                                                                                                                                                                                                           | M    |
| 4   | Input: pointer lock, `walk.ts`, `'walk'`/`'sign'` scopes, keymap and legend rows, sensitivity and invert settings, i18n and glossary rows                                                                                                                                                                                                                                                     | M    |
| 5   | First-person camera, Einweiser mode in `computeViewports`, top-down token; `verify:layout`                                                                                                                                                                                                                                                                                                    | M    |
| 6   | View-model arms, pose table, framing test, draw-budget case                                                                                                                                                                                                                                                                                                                                   | M    |
| 7   | HUD: sign bar, sight cue, message placement; `layout.spec` sizes                                                                                                                                                                                                                                                                                                                              | M    |
| 8   | Scoring: person contact, faults, `sweptBodies`, `RunResult.einweiser`, debrief, result screen; Einweiser digest pin                                                                                                                                                                                                                                                                           | M    |
| 9   | Menu: "Einweisen" entry, `'position'` step, `settings.ts` role parse; first playable; changelog fragment                                                                                                                                                                                                                                                                                      | S    |

Estimate: nine PRs, of which PR 2 carries the risk. PR 3 can run beside PRs 1–2; after it, PRs 4, 5 and 8 can run in parallel, and 6 and 7 follow 5. Later phase: 4–6 PRs on top (§7).

## Verdict

**Go for the MVP, gated on PR 2.**

- Every seam exists: one `ControlVector` input, a pure fixed-step sim, change-only control logs, `predictCombination`, pure mounts and cab data, a free layer, and a role-ready menu.
- The owner's replay decision keeps the sim, `SIM_REVISION` and every stored driver run untouched.
- The one unknown is whether a sign-driven controller can hold a drawbar trailer in reverse and reach the tightest tolerance. PR 2 answers that headless, before any render work. If neither the planner nor the cascade fallback passes there, stop and re-plan before PR 3.

**No-go for now on the later phase.** Decide after the MVP is in use, with the desktop perf check in §7.

## Open questions for the owner

1. Abfahren: move off forward at creep whatever the Einweiser's position (the one sign not read in his frame), or a different meaning?
2. Must the first movement sign follow an Achtung (fault `noAchtung`)?
3. Facing: must the Einweiser face the driver (or the mirror he is seen in)? Side-on direction signs would be unclear, and with his back turned they would read swapped (§2).
4. Abeam: should Herkommen/Entfernen from beside the middle of the combination be unclear, with the driver waiting?
5. Herkommen/Entfernen: should the driver hold the leading end straight, or keep the last steer?
6. Abstandsverringerung: crawl until Halt in the MVP, with an indicated gap (e.g. mouse wheel) later?
7. Keys:
   - latched signs with 0 = no sign, or hold-to-show?
   - source order puts Rechts (7) left of Links (8): swap them?
   - add the Q/E and Space alternates?
8. Default standing point: rear left (driver's side), or rear right as the DRK material teaches? Both are offered in the setup step.
9. Menu: a separate title entry "Einweisen", or a role row inside Exercises (the menu spec left this to #443)?
10. No Einweiser bests in the MVP?
11. Driver responsibility: the AI never avoids static obstacles and does not know the target (contacts are the trainee's), but brakes for a visible Einweiser in its path. Agree?
12. First-person arms: adapted poses keep both arms in frame (Halt's arms angled forward, Achtung's arm forward-up, idle arm lowered), while the sign bar's pictogram shows the source pose. Is that close enough to "sees his own arms perform each sign"?
13. No preset flag for the Einweiser view and arms (they are the mode, not a realism layer). Agree?

## Proposed glossary rows

| Concept                                | English                                                                                                 | German                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Person guiding the vehicle on foot     | ground guide                                                                                            | Einweiser                                                                                                       |
| Title entry and role of this mode      | ground guiding                                                                                          | Einweisen                                                                                                       |
| One BG sign                            | hand signal                                                                                             | Handzeichen                                                                                                     |
| Signs 1–9                              | Attention, Halt, Halt – danger, Move off, Come here, Move away, Move right, Move left, Closing distance | Achtung, Halt, Halt – Gefahr, Abfahren, Herkommen, Entfernen, Rechts fahren, Links fahren, Abstandsverringerung |
| Key 0: arms down                       | no signal                                                                                               | Kein Zeichen                                                                                                    |
| Driver sees the Einweiser              | sight contact (direct / in mirror / none)                                                               | Sichtkontakt (direkt / im Spiegel / kein)                                                                       |
| Driver cannot read a sign              | signal unclear                                                                                          | Zeichen unklar                                                                                                  |
| Setup step: where the Einweiser stands | position                                                                                                | Standort                                                                                                        |
| Look sensitivity setting               | mouse sensitivity                                                                                       | Mausempfindlichkeit                                                                                             |
| Invert vertical look setting           | invert mouse                                                                                            | Maus invertieren                                                                                                |

The sign is "Halt" in both languages, kept apart from the driver's "Stopp"/"stop" control.
