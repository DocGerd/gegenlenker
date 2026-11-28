# Einweiser mode — spike design (#443)

The trainee stands outside the combination as Einweiser and gives the BG hand signs; an AI driver executes them. This document answers the nine questions of #443. No code.

"Decided (owner)" = stated by the owner. "Call" = proposed here, open to correction. "Estimate" = a number not measured or sourced. Code references name the module and symbol.

## Source

The issue cites ASR A1.3 Anhang 1; the hand signs are **ASR A1.3 Anhang 2 "Handzeichen"** (Anhang 1 is the Sicherheitszeichen); the rules are in Nr. 5.7. The vehicle signs are also DGUV Vorschrift 70 Anhang 4 "Handsignale für Einweiser von Fahrzeugen", with identical wording.

- Decided (owner): exactly the nine vehicle signs of DGUV V70 Anhang 4. No Heben, Senken or Langsam (ASR's "Handzeichen für Bewegungen — vertikal", not in V70), no invented end sign.
- Decided (owner): signs are read in the Einweiser's frame. Herkommen = the vehicle moves toward the Einweiser, forward or in reverse depending on where he stands; Entfernen = away from him; Rechts/Links fahren = toward his own right/left ("vom Einweiser aus gesehen", ASR wording).
- Source rules: the Einweiser stays in the driver's field of view and never between the moving vehicle and obstacles in its path; the driver stops at once when he loses sight of the Einweiser (DGUV V70 §46(2) and its DA; BG Verkehr G2 "sofort anhalten!"). The trainer enforces them through the lost-sight grace timer (§2) and the `inPath` and `outOfSight` faults (§4).
- Walking backwards: G2 "sollte nicht rückwärtsgehen", DLRG "niemals", UKH "möglich, wenn es der Verkehr und die Straße erlauben". Decided (owner): an advisory debrief note, not a fault.
- Distances: ASR A1.3 and DGUV V70 give none. BG E5 (refuse collection) draws the Einweiser about 3 m behind the vehicle rear, outside its track. DLRG teaches its own sign set with vehicle-frame meanings, so it is weak authority for BG-sign rules.

## 1. Signal vocabulary

| Key | Sign                 | Pose (ASR A1.3 Anhang 2, abridged)                                                        | Motion                          | Driver intent (Einweiser frame)                                                                                                         |
| --- | -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Achtung              | right arm up, palm forward (alias "Anfang, Vorsicht")                                     | static                          | opens the Einweisung; the driver attends and holds the brake. Decided (owner): not required; a movement sign without it is a fault only |
| 2   | Halt                 | both arms out sideways, horizontal, palms forward                                         | static                          | lever to 0, brake at standstill                                                                                                         |
| 3   | Halt – Gefahr        | as Halt, arms alternately bent and stretched                                              | loop                            | brake at once                                                                                                                           |
| 4   | Abfahren             | right arm up, palm forward, arm moved sideways to and fro                                 | loop                            | Decided (owner): move off forward at creep wherever the Einweiser stands; the in-path brake still applies                               |
| 5   | Herkommen            | both arms bent, palms inward, forearms beckon                                             | loop                            | Decided (owner): move toward the Einweiser at creep, leading end straight                                                               |
| 6   | Entfernen            | both arms bent, palms outward, forearms wave away                                         | loop                            | Decided (owner): move away from the Einweiser at creep, leading end straight                                                            |
| 7   | Links fahren         | left arm horizontal, slightly bent, moved sideways to and fro                             | loop                            | leading end curves toward the Einweiser's left; direction unchanged (from standstill: §2)                                               |
| 8   | Rechts fahren        | as 7, right arm                                                                           | loop                            | leading end curves toward the Einweiser's right                                                                                         |
| 9   | Abstandsverringerung | palms parallel, brought together with the distance ("Anzeige einer Abstandsverringerung") | one closing movement, then held | Decided (owner): crawl in the current direction until Halt; an indicated gap comes later                                                |
| —   | (no sign key held)   | arms down                                                                                 | —                               | as Halt: motion needs a sign in view                                                                                                    |

- The leading end is `Prediction.lead` (`src/contracts/sim.ts`): the trailer rear (solo, the truck's) in reverse, the truck front forward.
- Abfahren is the one sign not read in the Einweiser's frame. ASR and V70 give only its pose, and G2 and E5 omit it.
- Decided (owner): a sign shows while its key is held; release lowers the arms. Bindings by `KeyboardEvent.code`: `Digit1`–`Digit9` and `Numpad1`–`Numpad9` (7 = Links, 8 = Rechts, V70's print order); alternates `KeyQ` = Links, `KeyE` = Rechts (free once mouse look replaces the Q/E glance) and `Space` = Halt (the driver's Stopp key).
- Decided (owner): with several sign keys held, the last pressed shows, and the driver keeps the last sign it recognised until it recognises the next (§2). A press or release cuts over at once with a short blend (0.15 s, estimate), so Halt never waits for a cycle to end. Arms down is recognised like a static sign, so a quick change of keys does not stop the vehicle.
- Signalling while walking: UKH "Sobald sich das Fahrzeug bewegt, muss sich auch der Einweisende bewegen um den Sichtkontakt zum Fahrer zu halten." Decided (owner): under pointer lock the left mouse button is Herkommen and the right one Entfernen (the keys stay), so with Q/E/Space the signs given on the move sit beside WASD. The click that takes the lock shows no sign, and the canvas suppresses `contextmenu`.
- The name and a pictogram of the source pose (front view, as the driver sees it) show in the sign bar while the sign is held: the first-person view cannot show the whole sign (§3.3), so the pictogram teaches what it looks like. The pictograms are drawn from the pose table, not copied from the ASR.
- Legend: a sign bar of nine slots (twelve in the steering mode, below) (key, name, pictogram; the shown one marked) in the band at the bottom of the view; walk, look, jog, pause and the mouse-button signs in the key legend. New `Scope`s `'walk'` and `'sign'` in `src/input/keymap.ts`, with rows in `KEYMAP` (table order = legend order; `keymap.test.ts` and `legend.test.ts` extend).

### Signalling modes (#572)

Decided (owner): a setup row (Einweiser only, stored like the lighting) picks how he signals a turn; the track logs it (`EinweiserTrack.mode`, absent: `'tail'`).

- Tail direction: the nine signs above.
- Steering: for narrow spots where the driver relies on him alone. Links/Rechts fahren give way to five steering signs (not in V70): the wheel a little (0.5 of full lock, owner) or to full lock toward his own side, or straight. Pose: both hands turn an imagined wheel before the chest (estimate); the pictogram adds the wheel with an arc the way it turns, longer for full lock, and a mark at its top for straight. Keys: 7/8 full lock, Q/E a little, X straight, in one legend row with the others (the bar names each key). The bar has twelve slots, in two rows of six where the band is under six times as wide as tall (at 800×585), so a figure stays as wide as in the nine-slot bar; slot names show only from 960 px.
- His own side, like Links/Rechts fahren: the driver mirrors him by his facing against the cab's heading, so facing the cab his left turns the wheel right (`signalledWheel`, `src/einweiser/driver.ts`). Facing within 30° (estimate) of square to the cab, a steering sign to a side is unclear (`CROSSWISE_HALF_ANGLE`, `src/einweiser/signs.ts`): his left and right are neither side's of the driver.
- A steering sign moves like Links/Rechts fahren (from standstill in Herkommen's gear, else the current one) and is read like them. Herkommen, Entfernen, Abstand and Abfahren keep the wheel where the last steering sign set it; the driver holds no heading.
- The driver still refuses a limit stop: every 0.25 s it holds the wheel only if, 0.6 m on (estimates), full lock in the same gear could still unfold the combination, and otherwise turns it back toward straight, else halts; a refused wheel is checked once more at the standstill, and the share only shrinks until the next sign. Forward that bites only near the limits. In reverse full counter-lock undoes a fold only up to about 30° coupling (measured on all four pairs, from a full or half-lock fold), so it halts at 26–29°; from there full counter-lock unfolds through straight in reverse, a little counter-lock or straight barely moves it, and Abfahren or Entfernen always do. No HUD cue shows a refusal yet.

## 2. Driver model

An AI `ControlSource` emits one `ControlVector` per sim step. It only steps targets: the sim already rate-limits steer (`steerRate`) and ramps speed to `lever × V_MAX` with `ACCEL`/`DECEL`/`BRAKE_DECEL` (`nextSpeed`, `src/sim/simulation.ts`), so the change-only input log stays sparse.

Per step the driver reads the held Einweiser pose, the active sign and the sight result (§3.5), and keeps a FIFO of what it perceived, so it acts on each perception after a fixed delay.

### What the driver does

- Decided (owner): it only follows signs and brakes for a visible Einweiser in its path. It does not know the target, does not avoid static obstacles and never picks a direction itself, so contacts, target error and direction changes come from the trainee's signs. A run-over stays possible when he steps in within stopping distance or stands in the path unseen.
- Call: it keeps the articulation stable (rejects any steer that predicts a limit stop), holds speed to the sign's lever, stops on Halt, no sign or lost sight, and brakes as for Halt – Gefahr when the Einweiser is visible inside its swept path within stopping distance plus 1 m (estimate; G2: stop for persons in the Gefahrenbereich, "Das kann auch die einweisende Person sein").

### Einweiser frame

- Decided (owner): forward and back are set by the cab's transverse axis at the driver's position ("back and forth is based on the querachse of the führerhaus, at level of driver"), i.e. the line through `truckAnchors(spec).eye` across the truck heading. Ahead of it, Herkommen is D and Entfernen R; behind it, Herkommen is R and Entfernen D. Abeam is a narrow band on that line (±0.5 m, estimate), where the sign is unclear and the driver waits.
- The side is read continuously, so walking cannot flip the gear without passing through the band. Decided (owner): when the band reaches him while the sign is held (the cab draws level, or he walks level with it), the driver stops as on Halt, with no `unclear` fault; only a sign given from inside the band is unclear.
- Decided (owner): from standstill, Rechts/Links fahren and Abstandsverringerung take Herkommen's gear from his side of the axis; while moving they keep the current gear.
- A gear change stops first (lever 0, brake), shifts at standstill, then moves; the sim counts it in `directionChanges`.
- Rechts/Links: the indicated world direction is the Einweiser's heading −90° (right) or +90° (left) (sim plane: counter-clockwise positive), from the held pose at recognition. Its side relative to the leading end's direction of motion is the steer goal.
- Worked cases (straight combination): behind a reversing combination, facing it, the Einweiser faces the truck's heading, so his right is the driver's right. In front of a truck driving forward, facing it, his right is the driver's left: the driver mirrors.

### Steering: a planner, not a sign→steer table

With a turntable drawbar trailer in reverse, the trailer rear first goes the way the wheel is turned (double inversion; `src/sim/simulation.test.ts` pins it per vehicle pair), and its later response depends on the articulation state, so no fixed steer sign means "rear to the right". The driver does not encode it:

- Every 15 steps (0.25 s, estimate) it calls `predictCombination` (`src/sim/predict.ts`) for nine candidate steers −1…1 over 3 m (estimate), with a pivot-only `ContactQuery` (`() => null`), so only limit stops block.
- Cost = |predicted leading-end heading change − goal|; goal 0 for straight, ±3 m / 15 m for Rechts/Links (curve radius 15 m, estimate). Blocked candidates are dropped. It keeps the current steer unless another candidate beats it by a margin (hysteresis), so the steer changes rarely.
- The heading comes from the midpoints of `Prediction.left`/`right`. `predictCombination` predicts only in D or R, ramps the road wheels only when moving and sets them to the target at once from standstill, so the planner passes the snapshot with the sign's gear, the candidate steer and its speed set to creep.
- `predict.ts` becomes a gameplay input: the derived faults read it (`contactAhead` for `lateHalt`, `sweptBodies` for `inPath`), hence `EINWEISER_REVISION` (§5). The driver's own use needs nothing, since its controls are logged. The PR that adds `sweptBodies` updates CLAUDE.md, which calls `predict.ts` display-only.
- Fallback if the gate test (§9) shows the planner cannot hold a reverse: a cascade controller (goal trailer heading → turntable angle → coupling angle → steer).

Accepted by the owner (2026-11-26) after the gate (PR 2), which departs from the planner above in three ways:

- Reverse steering is LQR state feedback on the linearised articulation, not the nine-candidate planner. In the scripted Einweiser the dock-ramp and reverse-bay reverse legs also choose their sign by LQR cost-to-go (their forward legs by the rollout search on the body heading); the driver itself is unchanged by that.
- "Straight" after a curve: the driver holds one reference heading per gear. Rechts/Links turn it; Herkommen, Entfernen and Abstand hold it, so the vehicle finishes the indicated turn.
- The curve radius depends on the gear (`CURVE_RADIUS = { D: 8, R: 15 }`): the slalom weave needs a truck curvature above 1/15 m⁻¹.

The gate runs with `pnpm test:gate` (`src/einweiser/gate-*.test.ts` except the `gate-recovery.test.ts` unit test, over `gate-harness.ts`; `vitest.gate.config.ts`). It is not part of `pnpm test` or `pnpm check`; the advisory `einweiser-gate` CI job runs it and does not gate a merge.

### Speeds and timing (calls)

| Item                                                       | Value                                                                                                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creep lever (Herkommen, Entfernen, Rechts/Links, Abfahren) | 0.5 (estimate); creep stays below walk speed (§3.1), so he keeps pace without jogging                                                                                                           |
| Crawl lever (Abstandsverringerung)                         | 0.15 (estimate)                                                                                                                                                                                 |
| Reaction `T_r` (all signs, lost sight)                     | 0.7 s, estimate: no reaction-time source in this spike; tuned in the gate PR                                                                                                                    |
| Recognition                                                | `T_r` for static signs and arms down; `T_r` + 0.5 s (half a cycle, estimate) for looping signs and Abstandsverringerung's closing movement; Halt – Gefahr at `T_r` (it starts in the Halt pose) |

Stopping distance = `v·T_r + v²/(2·a)`, with `v` = lever × `V_MAX` and `a` = `DECEL` on Halt, `BRAKE_DECEL` on Halt – Gefahr and lost sight (`src/sim/constants.ts`).

A sign shown for less than its recognition time is never acted on.

### Unclear signs (deterministic)

Nothing is misread. A sign the driver cannot read is unclear: it waits, or stops if moving, so an unclear Halt still stops the vehicle. Decided (owner): every unclear sign scores `unclear`, Halt included. Pure functions of pose, facing, range and timing; no `Math.random` (banned in core lint), no seed.

- Station (decided (owner)): Herkommen/Entfernen given from inside the abeam band (above).
- Facing is measured between the Einweiser's heading and the line from him to where he is seen (the eye, or the mirror mount), with a tolerance of 60° (estimate).
- Readability (decided (owner), §3.5): every sign needs its hand points seen on its path and him within the reading range.

| Signs                                                                     | Facing tolerance               | Readability                                                     |
| ------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| Herkommen, Entfernen, Rechts/Links fahren, Abfahren, Abstandsverringerung | applies, never swapped (owner) | applies (owner)                                                 |
| Achtung, Halt, Halt – Gefahr                                              | does not apply (owner)         | applies (owner): a Halt seen without its hand points is unclear |

- Decided (owner): facing is checked at recognition only, so he may turn away afterwards, e.g. to walk forward (UKH: "Im Zweifel ausschließlich vorwärts laufen und Fahrzeug nachrücken lassen").
- Out of sight or too short: ignored (scored, §4).
- Later option: a seeded "noisy driver" with the seed in the log; not in the MVP.

### Lost sight

- Sources say stop at once. Decided (owner): a bounded grace timer. A loss shorter than `T_r` is forgiven, and a cumulative timer caps the forgiven losses (estimate; decided (owner): summed since the vehicle last stood); a loss that lasts `T_r`, or one that takes the sum over the cap, starts the stop, which brakes (`BRAKE_DECEL`). So a pillar or a mirror edge that hides him briefly does not stop the vehicle, but repeated losses do. PR 2 pins the stop from creep inside the ~3 m spacing E5 shows.
- Decided (owner): after a lost-sight stop a held sign restarts the driver once it is re-recognised after sight returns (full recognition time); a key held only out of sight counts for nothing. This matches UKH: stop first, the Einweiser repositions, restores sight, then signals again.

## 3. Einweiser view and body

### 3.1 Walking and look

- `src/einweiser/walk.ts` (pure): `walkStep(pose, held, dt, colliders) → pose`.
  - WASD in the facing frame (`KeyboardEvent.code`, same physical keys on QWERTZ/AZERTY); arrows as alternates; Shift jogs.
  - Walk 1.4 m/s (Weidmann mean 1.34 m/s), jog 3.0 m/s (estimate), 0.2 s acceleration ramp (estimate).
  - A 0.25 m circle (estimate) slides along obstacle OBBs, decor (§3.5) and the combination's bodies, clamped to the yard. Obstacles below a 0.3 m step height (estimate), such as kerbs, do not block.
  - `walkStep` only clips his own motion and never pushes him out of a body, so a body that moves into him overlaps him and counts as a run-over (§4).
- Look (`src/input/pointer-lock.ts`, `src/input/walk-input.ts`):
  - `canvas.requestPointerLock({ unadjustedMovement: true })` on a click; on `NotSupportedError` (Chrome on Linux) retry without options; guard the non-promise return.
  - State comes from `pointerlockchange`/`pointerlockerror`. Releasing the lock with `P` (hinted while locked, no legend row) or losing it (Esc, blur, tab switch) opens the pause sheet; resuming takes a click (no auto re-lock; browsers refuse quick re-locks). The sim already freezes while the sheet is open (`advanceClock`, `src/app/drive.ts`).
  - The first `mousemove` after lock is dropped, single deltas above 300 px (estimate) are clamped, deltas are summed per frame and ignored while unlocked.
  - Yaw/pitch at 0.05°/count (estimate; a raw count with `unadjustedMovement`), pitch clamped to ±85°, no roll, no smoothing, no head bob, no FOV kick.
- Settings (call): choice rows "Mausempfindlichkeit" (Niedrig/Mittel/Hoch = 0.025/0.05/0.1°/count, estimates on the cited cm/360 scale) and "Maus invertieren" (Aus default/An). Decided (owner): an FOV slider (§3.2). Head bob is not offered.
- Rebinding: not offered (a non-goal of the menu spec). Bindings are by `code` with alternates; a later rebind UI refuses Ctrl/Alt/Meta combos, since `Keyboard.lock` is limited and the browser keeps Ctrl+W/T/N.
- Conflicts: WASD, arrows, digits, Space and Q/E are drive or view keys today. Call: Einweiser mode mounts no driver keyboard, wheel or lever (`createControls`) and drops the chase, free-camera, orbit/tilt and glance bindings (§3.4; mouse look replaces the glance). `'walk'` and `'sign'` take precedence over the remaining `'view'` keys (pane follow/yard, zoom, reset), which match by `key`. Ctrl/Alt/Meta stay unbound (`createKeyboard` already ignores them).

### 3.2 Camera

- First-person camera at the held pose, eye height 1.60 m (estimate; DIN 33402-2 is paywalled).
- Decided (owner): an FOV slider "Sichtfeld", horizontal 70–110°, default 90°, taken at 16:9 and applied Hor+ (three's `fov` is vertical). The view-model camera keeps its own fixed FOV (§3.3), so the arms' framing does not depend on the slider.
- Layers `EINWEISER_LAYERS = [PERSPECTIVE_LAYER, CAB_LAYER]` (`src/render/seams.ts`): he sees the cab exterior, the sky dome and the skyline, not `INTERIOR_LAYER`. Far plane `CAMERA_FAR`.
- Decided (owner): no preset flag for the view and arms. They are the mode, not a realism layer, and the mode draws no driver mirrors (§7), so it costs fewer passes than driver mode on every preset, Low included.

### 3.3 Arms (view model)

- Rig: rigid segments per arm (upper arm, forearm, hand; hi-vis yellow sleeve, after ASR 5.7(3) "vorzugsweise in gelber Ausführung"). Procedural geometry in `src/render/einweiser-arms.ts`; no Blender, no skinning.
- Pose table: joint-angle keyframes per sign as pure data in core `src/einweiser/sign-poses.ts`, slerped and looped by render. It also gives the sight check its hand points (§3.5) and drives the pictograms and the later avatar; render and HUD import it from core, so no `THREE_FREE_RENDER` entry is needed.
- Decided (owner): adapted first-person poses keep both arms in frame, while the pictogram and the avatar show the exact BG pose. Halt's arms point straight sideways and Achtung's straight up, outside any usable FOV, so the view model uses first-person versions (hands at about ±25° azimuth, inside the least ±30° half-width, raised arm forward-up; Unreal's split of first-person and world representation). One-arm signs (Achtung, Abfahren, Rechts/Links fahren) show the idle arm lowered with its hand at the lower frame edge.
  - A unit test projects every sign's keyframe hand and forearm points through the view-model camera at the narrowest supported aspect and asserts them in frame and above the band, so "both arms in frame for every sign" is pinned like `cockpit-interior.test.ts`.
- Pass:
  - Same scene, a new `VIEWMODEL_LAYER` (the next free layer in `src/render/seams.ts`), its own camera with a fixed 60° vertical FOV (estimate, Bevy's pattern), and a view offset that frames the arms above the band.
  - It renders right after the first-person pass with a depth-only clear: `autoClearColor = false`, `autoClearDepth = true`, folding the clear into the pass. An explicit `clear()` costs an extra multisample resolve on WebGL 2 (comment in `src/render/three-renderer.ts`). On WebGPU the in-pass clear is a load op that ignores the scissor, which for depth only leaves earlier panes' colour intact.
- Pitfalls:
  - The view-model camera uses `layers.set(VIEWMODEL_LAYER)`: every camera sees `DEFAULT_LAYER` and `enableLayers` only adds, so it would redraw the scene over the cleared depth.
  - `scene.background` is unset (the sky is a dome on `PERSPECTIVE_LAYER`), so the second pass draws no backdrop.
  - The arms use an unlit node material whose colour scales with a look uniform (day/night): no light change (changing the light set recompiles every program), no shadow sampler (High-night is near the 16-sampler limit), `castShadow` off, `VIEWMODEL_LAYER` kept out of `SHADOW_CASTER_LAYERS`.
  - Lights routed through `prepareShadow` (`src/render/sun-shadow.ts`) render their map once per queued frame on explicit layers. Verify for every shadow-casting light that the extra camera triggers no second shadow render (`drawCalls` in `e2e/draw-budget.spec.ts`).

### 3.4 Body in the world

- Top-down: an Einweiser token (disc plus facing wedge) on `AIDS_LAYER` in a scene token colour (T1–T4 contrast, `tokens.test.ts`), the same on every preset.
- Perspective avatar (same pose table, source poses) on a new `AVATAR_LAYER` (the next free layer), seen by chase and mirror cameras but not by his own first-person camera. It ships after the MVP, for the replay outside view and the later phase. Decided (owner): until then Einweiser mode offers no chase view or free camera, where he would be invisible.
- `RenderFrame.einweiser?: { pose, sign, phase }` (`src/contracts/render.ts`), updated like the vehicle visual.

### 3.5 Line of sight (pure core)

There is no mirror plane in code: a mirror is a camera at a mount with yaw, pitch, roll, vertical FOV and aspect (`MirrorSpec`, `src/render/mirror.ts`; `CLASS_V`, `src/render/close-mirror.ts`). The core check uses the same model, so the AI sees what the driver's mirror views would show.

`sightOf(geometry, snapshot, points, occluders) → { direct: boolean; mirrors: readonly MirrorId[] }` in `src/einweiser/sight.ts`:

- Points: the Einweiser's head (1.60 m) and chest (1.30 m), estimates, at the held pose. Sichtkontakt = any point seen directly or in any mirror.
- Decided (owner): a sign is readable only when its hand points (source pose, `sign-poses.ts`) are seen on the same path and he is within a reading range for that path (direct and each mirror class, estimates); else "Zeichen unklar". ASR 5.7(1): Handzeichen must be "leicht durchführbar und erkennbar".
- Direct: the ray from the eye (`truckAnchors(spec).eye`, world via `snapshot.truck`) leaves through glass. That means the windscreen minus the A-pillars (`cabSight`, `src/render/cab-sight.ts`) or a side window (`TruckSpec.cab` `sideGlassSetback`/`sideGlassLength`), between the glass sill and top (`FRAME_TOP` + `glassSill` … + `glassHeight`), and the segment is clear of occluders other than the truck's own box: the eye sits inside it, and the glass test models the cab.
- Mirror: the point lies in the mirror camera's frustum (horizontal half-angle `atan(aspect·tan(fov/2))`), and the mount → point segment is clear of occluders, the truck's box included (the mounts sit outside its footprint; PR 1 tests it). The eye → mirror line is taken as clear, an assumption: `cockpit-interior.test.ts` pins the pillars off the mirror rects on screen, not the 3D eye-to-mount lines, so PR 1 adds a 3D check.
- Occluders: 2.5D boxes, i.e. the resolved layout's obstacles (`Obb` + `height`), its decor, and the combination's bodies (`bodyFootprints`, `src/sim/geometry.ts`, with cab, body and deck heights). Clip the segment's ground projection to the OBB (slab test); it is blocked if the segment's height at either clip end is below the box height. Exact for boxes, cheap.
  - Decided (owner): `Decor` (`src/contracts/layout.ts`: "no collision, not part of a run") gains a height, occludes sight and blocks walking in Einweiser runs, and joins the Einweiser data hash (§5); it is drawn opaque, so a swap body must hide him.
- Fixed inputs: the full mirror set the trucks carry (II left/right, IV left/right, V, VI), whatever the preset, the wide-angle mirrors setting or the window. Class II gets a fixed aspect from its glass (`GLASS.main`, `tools/blender/cab_shell.py`; today it follows the layout rect). So the gameplay result never depends on graphics.
- Moves from render to `src/vehicles/` (render re-exports): mirror optics (`CLASS_II_YAW`, `WIDE_YAW`, the class II/IV/V/VI specs' numbers, `WIDE_ASPECT`, `FRONT_ASPECT`, `CLOSE_ASPECT`), `frontMirrorMount`/`closeMirrorMount` (`src/render/mirror-fields.ts`), `cabSight` and the cab dims it reads (`FRAME_TOP`, `CAB_HEIGHT`, the `cabShellParams` subset), and body heights (the truck's `TIPPER_WALL_TOP`, `TARP_TOP`, `BODY_SHELL` in `src/render/body-dims.ts`; `SWAP_BODY_HEIGHT` and deck heights in `src/render/trailer-dims.ts`). Core may not import `src/render`; the optics also use three's `MathUtils.degToRad` (`src/render/mirror.ts`) and are rewritten without it.
  - The heights become `estimate()` Params on the vehicle specs, listed by `pnpm estimates`. Like the mirror mounts they stay outside `VehicleParams`, so `dataFingerprint` and the `run.test.ts` digests do not move; the Einweiser data hash covers them (§5).
- Reversibility of light paths: a mirror that shows the Einweiser to the driver's eye shows the driver's eye to the Einweiser. So the same result is the eye-contact truth for both, and later real reflections only show it.

### 3.6 Sight cue (MVP)

A HUD cue top left of his view: an eye icon and text, never colour alone.

| State   | Text                                                                                        |
| ------- | ------------------------------------------------------------------------------------------- |
| direct  | "Sichtkontakt"                                                                              |
| mirror  | "Sichtkontakt im Hauptspiegel links" etc., with the mirror names in the glossary rows below |
| none    | "Kein Sichtkontakt"                                                                         |
| unclear | "Zeichen unklar", briefly, when the driver waits or stops on an unclear sign                |

### 3.7 Layout

- `computeViewports` (`src/render/viewports.ts`) gets an Einweiser mode: the cockpit rect becomes the first-person view, with no mirror rects or extras, no controls (`controlsHeight` 0) and no sight cone (`CLEAR_CONE_DEG` is the cockpit's).
- Call: the top view stays optional through the existing no-pane flag. `mirrorsOnly` (log, best key) means "no top-down pane" (`hasTopDown()`), labelled "Mit Draufsicht / Ohne Draufsicht" for this role (glossary row below), also on the title's replay button (`src/app/menu/screens/title.ts`, which shows `driveViewMirrors` today); aids are off without the pane, as today. The pane shows the top view only (§3.4).
- The band (`.hud-band`) holds the shown sign's name and the sign bar. The sight cue sits top-left of the view.
- `messageColumn` gets an Einweiser branch: top-centre of the view, clear of the cue and the band, with or without the pane. `messagesFit` and `expectMessagesClear` cover it at every `e2e/layout.spec.ts` size, and `pnpm verify:layout` runs per the `verify-viewport-layout` skill.
- The HUD's `pedalsBox` becomes optional (no pedals in this mode).

## 4. Scoring

`src/scoring/einweiser.ts`, a per-step tracker beside `createRunTracker`:

| Result / fault            | Rule                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| run over (fail, run ends) | decided (owner): the walker circle at the held pose, inflated by his displacement since the previous held sample (zero while he stands), overlaps a body (`bodyFootprints(…)`) while the vehicle moves faster than `STOPPED_SPEED`; so live and replay agree, and a fail can come up to one hold interval early, never late |
| `inPath`                  | while moving, the person lies inside the swept footprints within stopping distance at the snapshot's speed + 1 m (`T_r` and the margin hashed, §5) (decided (owner), the only in-path fault; the cap is a trainer convention, since §46(2) sets none)                                                                       |
| `tooClose`                | while moving, clearance to any body < 0.5 m (estimate)                                                                                                                                                                                                                                                                      |
| `outOfSight`              | sight lost while moving: every loss the driver stops for (§2); repositioning while the vehicle stands is allowed (UKH)                                                                                                                                                                                                      |
| `signOutOfSight`          | a sign given while not in sight                                                                                                                                                                                                                                                                                             |
| `unclear`                 | any sign the driver could not read, Halt included (decided (owner)), per the table in §2 (station, facing, readability)                                                                                                                                                                                                     |
| `lateHalt`                | an obstacle contact while a movement sign showed and `contactAhead` (real contact query) had been true for longer than `T_r`                                                                                                                                                                                                |
| `noAchtung`               | a movement sign before the first Achtung (counted once; the driver still follows; decided (owner))                                                                                                                                                                                                                          |

- Swept footprints: `predict.ts` returns only the leading end's corner pair, and a reversing truck's front swings out. So `inPath` needs a pure `sweptBodies(params, from, distance)` beside `predictCombination` (same integrator).
- Every fault counts once per incident, the way `contacts` count once per incident key.
- Signal correctness is judged by its outcome: a wrong direction sign shows as contacts, target error or direction changes. Only `lateHalt` and the readability faults judge a sign itself.
- Walking backwards (against the facing faster than 0.3 m/s, estimate, while the vehicle moves) is an advisory debrief note, not a fault (decided (owner)).
- `RunResult` (`src/contracts/exercise.ts`) is reused whole: `reached`, `positionError`, `angleError`, `contacts`, `jackknifes`, `directionChanges`, `time` and `assisted` keep their meaning. It gains an optional `einweiser?: { runOver: boolean; faults: Readonly<Record<EinweiserFault, number>> }`; driver results serialise unchanged. A run-over ends the run at once with `reached: false`.
- Decided (owner): no Einweiser bests in the MVP. The result screen lists the faults, and `src/scoring/debrief.ts` adds one line per fault kind with its rule (e.g. §46(2)); `inPath`, `tooClose`, `lateHalt` and `noAchtung` are labelled trainer conventions, since no source binds them.

## 5. Determinism, replay, fingerprint, layering

Decided (owner): the AI driver's `ControlVector`s are logged and authoritative (replay works as today), plus an Einweiser track (pose and signs) for display; AI changes do not invalidate stored runs.

- Held pose:
  - The core never sees the live camera pose. Every 6 steps (10 Hz, estimate) the app samples it, quantises it (1 cm, 1 mrad) and holds it until the next sample.
  - The driver, the sight check and the fault tracker read only the held pose, so live and replay see the same numbers. The hold lags the live pose by at most jog speed × the hold interval; the run-over test carries his held displacement as margin (§4).
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
    | 'links'
    | 'rechts'
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
  - The track adds at most one sample per 6 steps, so `MAX_REPLAY_STEPS / 6` per run; an estimated few hundred kB worst case, far less while the trainee stands to signal. `storeLastRun` already drops a log whose write fails.

- Derived, not stored: sight states, faults and replay events are recomputed from snapshots plus track (pure, exact on the held pose). Call: one source of truth, guarded by a revision, like driver runs.
- Fingerprint:
  - The sim is untouched. The person is not in the sim's `ContactQuery`: the hit ends the run, so the sim need not block for it, and a controls-only replay cannot diverge. So `SIM_REVISION` does not move.
  - `dataFingerprint` is unchanged. Einweiser runs pass `scoring: { ...SCORING_THRESHOLDS, ...EINWEISER_THRESHOLDS, EINWEISER_REVISION }` and `RunIds` gains `role`, so driver runs keep their fingerprints and `run.test.ts` digests (evidence the seam refactor is behaviour-neutral).
  - `dataFingerprint` leaves out data the derived faults read: obstacle heights (visual-only today), decor, the `TruckSpec` eye, mirror and cab Params, the moved optics, the cab and body heights, the sign hand points, and `PREDICT_STEP`/`CONTACT_WARN_DISTANCE` (outside `SIM_CONSTANTS`, yet `contactAhead` reads them). `resolveRun` adds them to that `scoring` for Einweiser runs, so a change to any of them retires stored Einweiser logs instead of replaying them with other faults.
  - Shared reading rules feed both the driver and the derived faults: sight geometry, the cab-axis band, the facing tolerance, the reading range, the recognition times (facing and `unclear` are judged at recognition), `T_r` and the grace timer (`lateHalt`, `outOfSight`); the Achtung rule feeds only the faults. They live in `src/einweiser/signs.ts` and `sight.ts`, are hashed with `EINWEISER_THRESHOLDS`, and a change to them, to Einweiser scoring or to `predict.ts` bumps `EINWEISER_REVISION`. `inPath` takes its stopping distance from the snapshot's speed with the hashed `T_r` and its own hashed 1 m margin, so driver-only tuning (planner candidates, horizon, cost and hysteresis, lever values, the braking look-ahead) needs nothing. One pinned Einweiser digest per layout (a fixed v4 log) joins `run.test.ts`.
- Layering:
  - New core dir `src/einweiser/` (`signs.ts`, `sign-poses.ts`, `sight.ts`, `walk.ts`, `driver.ts`, `track.ts`) and types in `src/contracts/einweiser.ts`. Add the dir to `CORE` in `eslint.config.js` and to `tsconfig.core.json` `include`, with rules: sim imports neither `einweiser` nor `scoring`, and `einweiser` does not import `scoring`.
  - Not in `src/sim`: the sim stays the vehicle model whose revision guards driver runs, and the driver is outside the replay contract.
  - `src/app/drive.ts`: extract `ControlSource { tick(dt, snapshot); control(); lamps() }`; `createControls` becomes the manual source and `createAiSource` wraps driver, walk and track. The fixed-step loop (`controls.tick` → `control()` → `recorder.record` → `sim.step` → tracker) keeps its order, with the track recorder and Einweiser tracker beside the existing ones.

## 6. Exercise reuse

- Every exercise and free yard runs unchanged: `ExerciseDefinition`, start, target, tolerances, waypoint and obstacles are reused as they are. The run still ends when the tracker reports `reached`. `stoppedInTarget` (`src/scoring/score.ts`) takes any stop inside tolerance, a lost-sight, unclear-sign or gear-change stop included. Decided (owner): an Einweiser run ends only on a stop inside tolerance after a recognised Halt.
- Decided (owner): the Einweiser always starts 3 m behind the trailer rear (solo, the truck's), rear left (driver's side), outside the trailer's track (BG E5), with no setup step to change it; the outboard offset is an estimate. The start pose is a pure function of the exercise start and the rig's dims. It is not in `ExerciseDefinition`, so no driver-run fingerprint moves; the track's first sample logs it.
- Tightest: dock-ramp (`src/content/exercises/dock-ramp.ts`). The stop lands one stopping distance after Halt is shown, so the trainee gives Halt that much early; from crawl that distance is short, and a late Halt costs least.
- Slalom (`src/content/exercises/slalom.ts`, `briefSlalom`): forward through the cones to the turn point, then in reverse back into the bay. The forward leg needs Herkommen from ahead of the cab or Entfernen from behind it. At the turn point he walks back behind the trailer inside the kerbed lane, and the reverse leg needs Herkommen from behind while he walks with it (left mouse button). The slalom reverse joins dock-ramp as a gate case (PR 2).
- Whether every exercise leaves a standing point in sight and outside the swept path is answered by the gate test (§9).
- Menu (spec `docs/superpowers/specs/2026-11-25-main-menu-design.md`, "Role-ready"):
  - `Role` gains `'einweiser'`; catalogue entries reuse the exercise and layout ids with their own title and brief keys.
  - Decided (owner): a role row (Fahrer / Einweiser) in the Exercises and Free yard setup, with no `'position'` step. Call: it shows only with `matchMedia('(pointer: fine)')` and pointer lock available (desktop-only); elsewhere only the driver role exists, so no role is asked.
  - `settings.ts` parses only `role: 'driver'` as the last entry today, and `entryFrom` (`src/app/menu/continue.ts`, behind `lastEntryOf`) builds `role: 'driver'` from the log. Both must take `'einweiser'`, the latter from the log's `role`, so Continue resumes it.
  - The row lands with the first playable PR (no entry that leads nowhere).

## 7. Later-phase cost

Driver mode, from code reading: a scene pass per mirror in `MIRRORS` (`src/render/mirror.ts`; class IV alternates sides), the cockpit and pane passes, composites, the output pass and shadow passes (`e2e/draw-budget.spec.ts` counts them). `DRAW_CALL_BUDGET` (`src/render/quality.ts`) is asserted at 1920×1080 with every mirror.

| Item                       | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Cost (estimates)                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP                        | first-person pass (replaces the cockpit), view-model pass, pane 0–1; no driver mirror passes, since the trainee does not see them                                                                                                                                                                                                                                                                                                                                               | arms ≤ 10 draw calls; fewer scene passes than driver mode on every preset                                                                                             |
| Transparent cab glass      | `<group>-glass` is already its own mesh in the cab glb, merged with the lenses only at load (`bake`, `src/render/glb-shells.ts`): stop merging it and give it a transparent material sorted after opaque; no glb rebuild unless the glass shape changes                                                                                                                                                                                                                         | +1–3 draw calls per pass that sees the cab                                                                                                                            |
| Interior and driver figure | the Blender interior (`interior_shell.py`) is authored in the truck frame and placed at the eye each frame (`src/render/interior-glb.ts`), on `INTERIOR_LAYER`, cockpit camera only, and drawn only where `cockpitInterior` and `interiorGlb` are on. Reuse it on a layer the first-person and chase cameras see; the flat overlay and the lit lip are NDC-authored and stay cockpit-only. Add a seat and a driver figure (cockpit camera excluded) with an `ATTACHMENTS` entry | +4 (interior meshes) and +5–10 (seat, figure) draw calls                                                                                                              |
| Reflecting mirrors         | one planar reflection pass per visible mirror, culled with the pure sight geometry (facing + frustum): typically a few, at worst one per mirror in `MIRRORS`, each about one of today's mirror passes; convex class II/IV approximated by a widened FOV                                                                                                                                                                                                                         | comparable to driver mode's mirror passes; reusing the driver-eye mirror targets as glass textures would be free but is right only from the driver's eye, so rejected |

- Gating: preset flags `cabGlass`, `cabInterior` and `mirrorReflections`, High first and off on Low. An Einweiser case in `e2e/draw-budget.spec.ts`, a probe view in `e2e/perf/four-views.perf.ts`, a real-GPU desktop run of that probe (`pnpm test:perf`; `pnpm perf:tablet` emulates a touch tablet, where the role row is hidden) and an owner device check. Desktop fps impact: unknown until that run.
- Effort: 4–6 PRs (estimate); Blender work for the seat and driver figure.

## 8. Best practices (sources)

Signs and Einweiser rules:

- ASR A1.3, Anhang 2, Nr. 3.15, 4(6), 4(8), 4(10), 4(12), 5.7: https://www.baua.de/DE/Angebote/Regelwerk/ASR/pdf/ASR-A1-3.pdf?__blob=publicationFile
- DGUV Vorschrift 70 §46, Anhang 4: https://bg-verkehr.de/medien/medienkatalog/unfallverhuetungsvorschriften/dguv-vorschrift-70/at_download/file ; §46 with DA: https://vorschriften.bgn-branchenwissen.de/daten/dguv/70/46.htm

Teaching. Sequence in the sources: duty and accident examples → agree the signs → practice → yearly Unterweisung (ASR 4(12)). Practice: a course laid with lines, driven without mirrors and guided by one Einweiser (UKRLP); a cone box of vehicle length × width + 20 cm with mirrors folded or covered (the Übung 9 sheet, which names no publisher); at Schrittgeschwindigkeit (G2, UKH). Both run without mirrors, unlike this trainer's mirror-reading driver. The trainer mirrors the sequence: debrief lines cite the rule, and exercises run at creep.

- BG Verkehr G2: https://bg-verkehr.de/medien/medienkatalog/unterweisungsmedien/unterweisungskarte-g2/at_download/file
- BG Verkehr E5: https://bg-verkehr.de/medien/medienkatalog/unterweisungsmedien/unterweisungskarte-e5/at_download/file
- DGUV Information 205-024: https://publikationen.dguv.de/widgets/pdf/download/article/2871
- UKH: https://www.ukh.de/fileadmin/Medien/Medien/Unternehmen_und_Besch%C3%A4ftigte/1-044_Moderationshinweise_Rueckwaertsfahrt.pdf
- Übung 9 sheet: https://download.kfv-oh.de/FahrBerVO/6%20LG%20Fahr%fcbungen/HFUK%20Fahr%fcbungen%20mit%20Einsatzfahrzeugen/Uebung_9_Rueckwaerts_fahren_mit_Einweiser.pdf
- UKRLP: https://www.ukrlp.de/fileadmin/ukrlp/daten/pdf/startseite_internetseite/service/flyer_broschueren/sicherheit_einsatzfahrten_01.pdf
- DRK: https://www.bildungsinstitut-rlp.drk.de/fileadmin/Download/Fachuebergreifende_Bild/F%C3%BChrerscheinerweiterung_KatS_Schulung.pdf
- DLRG: https://obere-hunte.dlrg.de/fileadmin/groups/8350120/Einsatz/Merkblaetter/20200523_MB-OBH-WRD-02_Einweiserzeichen.pdf
- HSE reversing: https://www.hse.gov.uk/workplacetransport/factsheets/reversing.htm ; checklist: https://www.hse.gov.uk/workplacetransport/checklist/section5.htm ; banksmen: https://www.hse.gov.uk/construction/faq-banksmen.htm

Sign-selection UX:

- No ground-vehicle marshalling sim was found.
- An aircraft-marshalling VR trainer offers "guided or free play learning"; its planned autonomous version was dropped ("the results were too inconsistent for effective training, so the human-operator was required"), blamed on the variety of human bodies, which keyed signs avoid: https://cove.army.gov.au/article/innovating-army-aircraft-marshalling-training . The MVP is the guided mode (names and pictograms always shown); a variant that hides them is a cheap follow-up.

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

MVP: first-person Einweiser with arms, nine signs, AI driver, line of sight with the HUD cue, scoring, log v4, the FOV slider. Not in the MVP: the perspective avatar (and with it the chase view and free camera in this mode), the first-person replay, bests, and the later phase.

| PR  | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Size |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Move mirror optics (without `MathUtils`), mounts, cab sight and the cab and body heights (as `estimate()` Params) to `src/vehicles/` (render re-exports; no visual change, checked by shot hashes); decor heights; `src/einweiser/sight.ts` with the source pose table `sign-poses.ts`; `src/einweiser/` added to the core configs. Tests: rear left seen in the left class II; straight behind the trailer unseen; beside the cab seen directly; hidden by the trailer body when articulated; hidden behind a swap-body decor; eye-to-mount lines clear of the pillars in 3D | M    |
| 2   | **Gate.** `signs.ts`, `driver.ts` (planner, FIFO, station rule, lost sight), pure `walk.ts`, `sweptBodies` and the pure fault predicates (CLAUDE.md's `predict.ts` line updated), and a test-only scripted Einweiser policy, limited to `walkStep`, that reaches `reached` with zero faults in every exercise × vehicle pair, dock-ramp and the slalom reverse included; tests for the sign semantics per pair (Herkommen behind reverses toward him; Rechts behind moves the trailer rear to his right; in front it mirrors; Halt and lost-sight stopping distances)         | L    |
| 3   | `ControlSource` seam in `drive.ts`; log v4 parse/serialise; `RunIds.role`; driver digests unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | M    |
| 4   | Input: pointer lock, mouse-button signs, walk input, `'walk'`/`'sign'` scopes, keymap and legend rows, sensitivity, invert and FOV settings, i18n and glossary rows                                                                                                                                                                                                                                                                                                                                                                                                           | M    |
| 5   | First-person camera, Einweiser mode in `computeViewports`, top-down token; `verify:layout`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | M    |
| 6   | View-model arms (first-person poses), framing test, draw-budget case                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | M    |
| 7   | HUD: sign bar, sight cue, message placement; `layout.spec` sizes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | M    |
| 8   | Scoring wiring: person contact, `RunResult.einweiser`, debrief (trainer-convention labels, the walking-backwards note), result screen; Einweiser digest pin                                                                                                                                                                                                                                                                                                                                                                                                                   | M    |
| 9   | Menu: role row in the Exercises and Free yard setup, role parse in `settings.ts` and `continue.ts`, the replay label in `title.ts`; first playable; changelog fragment                                                                                                                                                                                                                                                                                                                                                                                                        | S    |

Estimate: nine PRs, of which PR 2 carries the risk. PR 3 starts once the gate passes; after it, PRs 4, 5 and 8 can run in parallel, and 6 and 7 follow 5. Later phase: 4–6 PRs on top (§7).

## Verdict

**Go for the MVP, gated on PR 2.**

- Every seam exists: one `ControlVector` input, a pure fixed-step sim, change-only control logs, `predictCombination`, pure mounts and three-free cab data (the mirror optics need a rewrite without `MathUtils`), a free layer, and a role-ready menu.
- The owner's replay decision keeps the sim, `SIM_REVISION` and every stored driver run untouched.
- The unknown is whether a sign-driven controller can hold a drawbar trailer in reverse and reach the tightest tolerance, guided by a walk-limited Einweiser with zero faults, so every exercise must leave a standing point in sight and outside the path. PR 2 answers that headless, before any render work. If neither the planner nor the cascade fallback passes there, stop and re-plan before PR 3.

**No-go for now on the later phase.** Decide after the MVP is in use, with the desktop perf check in §7.

## Proposed glossary rows

| Concept                                             | English                                                                                                 | German                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Person guiding the vehicle on foot                  | ground guide                                                                                            | Einweiser                                                                                                       |
| Role row in the Exercises and Free yard setup       | role (Driver / Ground guide)                                                                            | Rolle (Fahrer / Einweiser)                                                                                      |
| One BG sign                                         | hand signal                                                                                             | Handzeichen                                                                                                     |
| Signs 1–9                                           | Attention, Halt, Halt – danger, Move off, Come here, Move away, Move left, Move right, Closing distance | Achtung, Halt, Halt – Gefahr, Abfahren, Herkommen, Entfernen, Links fahren, Rechts fahren, Abstandsverringerung |
| No sign key held: arms down                         | no signal                                                                                               | Kein Zeichen                                                                                                    |
| Driver sees the Einweiser                           | sight contact (direct / in mirror / none)                                                               | Sichtkontakt (direkt / im Spiegel / kein)                                                                       |
| Mirror names in the sight cue (class II, IV, V, VI) | main / wide-angle / close-proximity / front mirror                                                      | Hauptspiegel / Weitwinkelspiegel / Rampenspiegel / Frontspiegel                                                 |
| Driver cannot read a sign                           | signal unclear                                                                                          | Zeichen unklar                                                                                                  |
| Einweiser screen with or without the top view       | view (With top view / Without top view)                                                                 | Ansicht (Mit Draufsicht / Ohne Draufsicht)                                                                      |
| Look sensitivity setting                            | mouse sensitivity                                                                                       | Mausempfindlichkeit                                                                                             |
| Invert vertical look setting                        | invert mouse                                                                                            | Maus invertieren                                                                                                |
| First-person field of view setting                  | field of view                                                                                           | Sichtfeld                                                                                                       |

The sign is "Halt" in both languages, kept apart from the driver's "Stopp"/"stop" control.
