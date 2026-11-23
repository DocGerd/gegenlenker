# Gegenlenker

Truck + turntable drawbar trailer maneuvering trainer. TypeScript, Vite, three.js, pnpm (Node 24). Targets: desktop/laptop first, tablet second (the perf reference device); phones are not a target.

## Verify

Dev server: `pnpm dev`. `pnpm verify` (`pnpm check`, then `pnpm test:e2e`, which builds with `BASE_PATH` itself) is the full gate after Install; run it before every PR. `pnpm check` (lint, format, typecheck, unit; no build or e2e) is the fast local loop for review-fix rounds, not the CI `check` job (which also runs e2e).

- Install: `pnpm install --frozen-lockfile`
- Lint: `pnpm lint`; format: `pnpm format:check` (fix with `pnpm format`)
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test`; single test: `pnpm exec vitest run <file> -t '<name>'`
- Build: `BASE_PATH=/gegenlenker/ pnpm build`
- Browser e2e: `pnpm test:e2e` (builds and previews itself unless `CI` is set; once: `pnpm exec playwright install chromium`); every `e2e/**/*.spec.ts` outside `e2e/webgpu/` runs in the `offline` project; `e2e/webgpu/` runs in the `webgpu` project (`pnpm test:e2e:webgpu`, the advisory `webgpu` CI job, not in `check`); default `expect.timeout` and `timeout` live in `playwright.config.ts`.
- `e2e/layout.spec.ts` in full is slow locally: iterate with `-g '<case>'`; CI runs it all.
- Parallel worktrees: e2e previews on a port derived from the checkout path (printed as `e2e preview port: N`), so no lock is needed; `E2E_PORT=<n>` overrides a clash (`--strictPort` fails loudly); a killed run can orphan a preview: `pnpm preview:stop` stops only this checkout's preview (`--port n` stops whatever listens there), never `pkill -f`. `pnpm shoot --out <dir> [shoot-views args]` builds, serves on a free port, shoots and tears down (rebuilds `dist/`: not beside `pnpm test:e2e`).
- Parallel PRs: the up-to-date ruleset serialises merges (each merge restarts everyone's CI); merge one at a time.
- CI e2e jobs are a matrix in `.github/workflows/ci.yml` on ~4-core runners: each job runs cost-packed `suite:i/n` slices (retune the table when a suite's cost shifts; the lint job checks it partitions each suite), and a new e2e test is tagged `heavyAt(preset)`, or `slowAt(preset)` when one test takes minutes (`e2e/pinned-shoot.ts`); reproduce CI-only slowness locally with `taskset -c 0-3`.
- Local-only ignores go in `.git/info/exclude` as unanchored patterns (`dir/`, not `/dir/`); the format scripts pass it to Prettier.

## Layering

- Only `src/render` imports `three`; `.ts` files are checked by `no-restricted-imports` in `eslint.config.js`, `dev/` harnesses are exempt.
- The renderer is `three/webgpu` (WebGL2 backend by default, `?backend=webgpu|auto|webgl2` in `src/render/gpu-backend.ts`): custom shading is TSL node materials only (`onBeforeCompile` is ignored, `ShaderMaterial` rejected). Three swallows TSL build errors and falls back to a plain material, so verify with `getShaderAsync`, for each preset's program (Balanced and High take different paths), not just High.
- Changing the light set or `castShadow` recompiles every program: set visibility and casting once per mount from the look; gear, brake and lamps change only intensity and colour.
- High-night PBR ground is near the 16-sampler limit: `countSamplers` (`src/render/ground-pbr-spec.ts`) gates it, and every new map or casting light counts.
- Three renders back faces into PCF shadow maps, so a thin shell shades nothing: cast from a `SHADOW_ONLY_LAYER` stand-in (`src/render/seams.ts`).
- Viewport origin is top-left; render-target readback is upside down. `drawCalls` counts output passes.
- The intermediate buffer is sRGB 8-bit + MSAA and renderer-wide: never make it per preset or a user setting (breaks top-down invariance). Compare unlit hues in e2e against `sceneRgb` tokens (`e2e/pinned-shoot.ts`, which also owns `MIN_DRAWN_COLOURS` and the settle deadline). SwiftShader rounds the MSAA resolve differently depending on timing; `startPinnedDrive` pins it (`pinResolvePath`), so take pixel-hash shots only through it.
- e2e pixel probes run on `startPinnedDrive` + `settle`, never the free-running loop: every extra perspective pass pushes software-GL polls past their timeout on CI; don't raise the timeout instead.
- `src/{contracts,vehicles,sim,scoring,content}` also import none of `render/app/hud/input/pwa/i18n` and use none of `window`, `document`, `navigator`, `localStorage`, `performance`, `requestAnimationFrame` (same config). Core lint also bans dynamic `import()`, `import.meta`, `Date`/`Date.now`, `Math.random`, `fetch`, `setTimeout`, `globalThis` (tests exempt from the syntax rules).
- Top-down-only drawing: put meshes on `AIDS_LAYER` (`layers.set`); only `topDownCamera` enables it. Cockpit/mirror-only meshes (sky dome, skyline) and perspective lights go on `PERSPECTIVE_LAYER` (a light is AIDS-only or seen by every perspective camera; `environment.test.ts`); cab-front parts on `CAB_LAYER` (mirrors and the chase view; the cockpit eye is inside the cab); before calling a cab or body change visible, check its frustum (`src/render/shell-visibility.test.ts`). Cameras enable layers via `enableLayers` with `COCKPIT_LAYERS`/`MIRROR_LAYERS`/`CHASE_LAYERS`/`TOP_DOWN_LAYERS` (`src/render/seams.ts`).
- Perspective scenery must stay inside `CAMERA_FAR` (`src/render/seams.ts`); `src/render/skyline.test.ts` pins it. The chase camera's far plane is `CAMERA_FAR + CHASE_MAX_DISTANCE` (`chase-camera.ts`).
- Graphics presets (`src/render/quality.ts`) gate every realism layer: a new perspective feature adds a flag, off on Low unless Low still passes the tablet bar (58 fps at scale 1.00) with it; top-down output never depends on the preset (check by screenshot hash per preset and per lighting mode; night tokens keep the TN targets in `docs/brand/BRAND.md`). High stays within `DRAW_CALL_BUDGET` (`quality.ts`; `e2e/draw-budget.spec.ts`, at 1920×1080 so every mirror draws); a new async perspective feature adds an `ATTACHMENTS` entry (`src/render/asset-registry.ts`), which drives its `<html>` marker and the e2e ready check (`readyMarkers` in `e2e/pinned-shoot.ts`).
- Perspective-only materials (vehicle PBR, ground texture) set maps/`envMap` per material, never `scene.environment`; layer-0 materials (seen top-down) never change.
- Cockpit interior: `INTERIOR_LAYER` (cockpit camera only), authored in the camera's NDC; `cockpit-interior.test.ts` pins the sight cone and mirror sight lines. The bottom of the cockpit is the opaque `.hud-band` (height in `src/hud/hud.css`): nothing a trainee must see goes there.
- Top-down share: `settings.topDownLayout`, clamped per screen by `topDownSplit()` from the measured `hud.panelsBottom`; `e2e/layout.spec.ts` divider checks guard it.
- Mirror-only runs (`mirrorsOnly`) have no top-down pane (`hasTopDown()`, `src/render/viewports.ts`) and force aids off: anything placed in the pane needs a mirror-only home.
- Prediction (`src/sim/predict.ts`) is display-only: one corner pair of the leading end; legend swatches share `AID_STROKE`/`AID_DASH_*` (`seams.ts`).
- Obstacle kinds in `RESTYLED_KINDS` (`src/render/yard-props.ts`) draw a token copy top-down only plus a detailed perspective prop; a new kind needs both.
- Vertex colours must be linear: set a `Color` from the palette (`color.set` converts) and pass it to `tint()` (`src/render/tint.ts`); raw palette bytes render too light. `tint()` drops UVs, so textured surfaces need their own geometry and material.
- ESLint is type-aware (`strictTypeChecked`), `noInlineConfig` and `--max-warnings 0`: fix findings in source.
- The `query(root, name, Type)` DOM helpers (menu, hud, controls) throw unless the element is `instanceof Type`: pass the real class (`SVGElement` for `<svg>`/`<g>`, `HTMLSelectElement` for `<select>`).
- Changing `--scene-*` tokens: keep the T1-T4 contrast targets in `docs/brand/BRAND.md`; `src/styles/tokens.test.ts` enforces them.
- `tokens.test.ts` checks token hex values, not rendered pixels: fog, tone mapping, ground detail or shadows can break top-down contrast unnoticed. Keep top faces on tokens, put realism on perspective-only layers, and check with a top-down screenshot.
- Mirror rects avoid the controls via `controlsHeight()` in `src/render/viewports.ts`, which copies control geometry from `src/input/controls.css` and `src/styles/tokens.css`: change both together. They also avoid the measured HUD legend (`hud.legendBox()` → `LegendBox`); `e2e/layout.spec.ts` pins no overlap.
- Extra mirrors (`computeViewports` extras) shrink, then drop: the minimum size comes from a legibility test on the ground-to-pixel Jacobian in texels (`front-mirror.test.ts`, `wide-mirror.test.ts`), and class II gives way to class IV down to `MIN_CLASS_II_SHARE` (`viewports.ts`); class IV needs both its preset flag and the wide-angle mirrors setting. Toasts and the goal cue go in `messageColumn`: beside the front mirror, else between the class II mirrors when `messagesFit`, else in the top-down pane below the finish button; always clear of every mirror, the controls and the sight cone (`messagesFit`; `expectMessagesClear` at every `layout.spec` size); a new message word wider than the measured ones fails `viewports.test.ts`.
- Size layouts by CSS viewport (`innerWidth`×`innerHeight` after browser chrome and OS scaling), never screen resolution: a 1080p laptop at 125–150% leaves about 1536×729 to 1280×585.
- Landscape/portrait CSS uses `(min-aspect-ratio: 1/1)`, never `orientation` (which calls a square portrait), matching `viewports.ts` (`width >= height` is landscape); safe-area padding uses the `--safe-*` tokens, which `computeViewports` also reads.

## Units and signs

- Sim: metres, radians, seconds; vehicle data (`src/contracts/vehicle.ts`): mm, degrees, turns/s.
- Sim plane: heading 0 points along the x axis, counter-clockwise positive, so positive heading is a left turn; body frame is x forward, y left, z up.
- Three space (`src/render/coords.ts`): x = x, z = -y, y up, `rotation.y` = heading.
- `ControlVector.steer` is the target, -1 (full right) to 1 (full left), rate-limited in the snapshot; `lever` is 0 to 1 of the speed cap; direction comes from `gear` (`R` gives negative speed).
- `couplingAngle` = truck heading - drawbar heading; `turntableAngle` = drawbar heading - trailer heading.
- Reversing with left steer, the trailer rear first goes LEFT (double inversion); `src/sim/simulation.test.ts` pins it for every vehicle pair.

## Vehicle data

- Every numeric vehicle dimension is a `Param` (`id`, `name`, `body` are not) with `status` `'sourced'` (`source` is an https URL from `src/vehicles/sources.ts`) or `'estimate'` (`source` is the basis).
- Use `sourced()` or `estimate()`; never present an estimate as sourced. `sourced()` takes only a `SOURCES` URL.
- Adding, changing, sourcing or removing an estimate means running `pnpm estimates` (rewrites the table in `docs/vehicle-data.md` between the `estimates:` markers); `src/vehicles/estimates.test.ts` fails otherwise.
- Bump `SIM_REVISION` in `src/sim/fingerprint.ts` only for sim, collision or scoring logic changes; `dataFingerprint` already hashes vehicle params, ordered obstacle OBBs (not ids), start, exercise, sim constants and scoring thresholds: visual-only prop changes keep stored runs; lighting and view mode are in the input log (v3: `lighting`, `mirrorsOnly`) and the best key (`/night`, `/mirrors`), not in `dataFingerprint`, and lamp state is not logged (replays use default lamps); adding or moving a collision prop invalidates them for that layout. `src/content/run.test.ts` pins `{ SIM_REVISION, digest }` per layout: an intended sim change updates the digest with the bump.

## Blender assets

- `tools/blender/{cab,body,trailer}_shell.py` (kernel `blender_common.py`, lamp helpers `lamp_common.py`) are the source of truth for the vehicle `.glb`s: run each unmodified through the `blender` MCP (`runpy.run_path` on its `wslpath -w` path; `init_globals` `PARAMS_PATH` or `PARAMS_JSON`, `OUT_PATH`, `EXPECTED_SHA256` `{scriptSha256, commonSha256, lampCommonSha256, paramsSha256}`: `runHashes` in `glb-build.ts`), then `pnpm glb:optimise <key> <raw.glb>` and `pnpm glb:manifest "<Blender version>"`; keys are `<truck id>-cab|body` and `<trailer id>-trailer` (one glb, `trailer` + `dolly` nodes).
- After changing those scripts, `scripts/glb-optimise.mjs`, their params, `src/render/{cab,body,trailer}-dims.ts` or `livery.ts`, run `pnpm glb:params` and rebuild (raw exports are not committed, so even an optimise-only change re-runs Blender; editing `blender_common.py` changes a recorded hash in every glb, so rebuild all assets, including the yard kit and its atlases; `lamp_common.py` only the cab, body and trailer glbs, not interior or the yard kit); `tools/blender/glb-build.test.ts` checks every input hash in the glb. Params numbers are 0 or ≥ 1e-4 (Python and JS print smaller floats differently).
- Yard kit: `tools/blender/yard_kit.py` (helpers `kit_common.py`, which records `commonSha256` + `kitCommonSha256`) bakes `yard-kit.glb` and its atlas pixels into the git-ignored `tools/blender/bake/`; `pnpm texture yard-kit-atlas-a|yard-kit-atlas-b|yard-kit-leaves` encodes them from there; `glb-build.test.ts` and the texture manifests check its hashes, `tools/blender/kit-build.test.ts` its structure and download budget; the `yardKit` flag draws it.
- Livery is colours only (no lettering, emblems or maker logos). Look dimensions in `src/render/livery.ts` are perspective-only render estimates, not Params, so they stay out of `dataFingerprint`.
- MCP-run bpy scripts must not call `read_factory_settings`: it reloads preferences and disables the MCP add-on.
- `tools/textures/` makes the KTX2 ground texture (`pnpm texture ground`); `tools/textures/ground-build.test.ts` fails when stale; it is runtime-cached at High, not precached.
- A new glb/ktx2 in `src/render/assets` needs an `ASSET_REGISTRY` entry (`src/render/asset-registry.ts`) naming the `QualityFlags` key that draws it: runtime-cached when that flag is off by default, else precached; `src/pwa/config.test.ts` fails on an unlisted file.
- `pnpm texture sky` builds the High HDRI `sky.ktx2` from the source `.hdr` (not committed; URL and SHA-256 in `tools/assets/sources.ts`; `docs/asset-credits.md` is generated from it by `pnpm credits`); `tools/textures/sky-build.test.ts` fails when stale.

## Tests

Test logic and critical paths only; no blanket coverage, no tests without value.

- Perspective detail (decals, wear, AO) must never hint at the target: derive it from bay geometry, not from what an exercise parks or marks, and test it across every exercise.
- e2e: await web-first assertions (`toHaveCount`, `toBeVisible`; `hudReady()` in `e2e/layout.spec.ts`) before measuring DOM boxes.
- Never spread a possibly empty list into `add()`: three reports that (and shader errors) only via `console.error`/`THREE.` warnings, not pageerror; `e2e/fixtures.ts` fails any test on those and on page errors, so specs import `test`/`expect` from it (lint-enforced) and exempt deliberate messages with `allow()`.

## Tablet perf check (manual, reference device: Android tablet, Chrome)

- Open https://docgerd.github.io/gegenlenker/?perf=1 and start a drive (`src/app/drive.ts` mounts the overlay only there); it shows fps, p95 frame ms, resolution scale, draw calls, GL renderer.
- Pass: at least 58 fps at resolution scale 1.00.
- Emulated locally: `pnpm perf:tablet [--throttle 6] [--functional]` (`e2e/perf/tablet-emulation.ts`, `docs/perf.md`; headed Chromium on a real GPU, aborts on SwiftShader/llvmpipe, exits non-zero below 58 fps at scale 1.00); host load makes it inconclusive, and a physical-tablet check still decides.
- `?probe` mounts `src/render/probe.ts`, which `pnpm test:perf` (`e2e/perf/four-views.perf.ts`; headed, local only, not CI) uses; that spec owns the automated thresholds and skips on software GL (SwiftShader, llvmpipe), so only a real GPU measures fps.
- Also check: two-thumb touch (wheel and lever at once), Android back gesture (history handling in `src/app/app.ts`), offline install, mirror sides.

## Visual check

- Headless Chromium screenshots of the real app work for visual checks (`pnpm exec playwright screenshot --lang de-DE <url> <png>`; scripts reuse the `@playwright/test` devDep); UI language defaults to the browser locale (`navigator.languages`) unless a saved setting overrides it; there is no URL parameter.
- Plain `playwright screenshot` can show a blank canvas under `.hud-band` (software compositing); e2e passes GPU-compositing SwiftShader args in `playwright.config.ts`. Read the canvas back before calling a blank region an app bug.
- Compare before/after by hash only at standstill with `performance.now`/rAF pinned in the shoot script: the resolution governor and the sim both step on wall-clock time, so other shots differ run to run.
- Headless screenshots run on software GL and passed a see-through skyline; perspective realism changes need an owner device check before calling them done.
- `node scripts/shoot-views.mjs --diff <before-dir>` compares pinned shots per view (`pnpm shoot --out <dir>` takes them); `?perf=1` fps is meaningless on SwiftShader.
- `pnpm shoot` covers one exercise per layout: for content or layout refactors that claim no visual change, also compare `yardProps` geometry (positions, colours, order) against main for every layout × exercise, including no exercise.

## Workflow

- Changes go through PRs; never push to `main`.
- `.claude/settings.json` is committed: a PostToolUse hook (`.claude/hooks/format.sh`) runs Prettier on each Edit/Write, and editing `pnpm-lock.yaml` is denied (change it through pnpm). Review `.claude/**` changes like code.
- Commit and PR titles use conventional prefixes: `feat`, `fix`, `docs`, `ci`, `chore`, `refactor`, `perf`, `test`.
- UI text goes through `t()`; keys live in `src/i18n/en.ts`, and `de.ts` is typed against them, so both must define every key. German UI wording follows `docs/glossary.md`.
- User-visible PRs add a `changelog.d/<pr>.<category>.md` fragment (format: `changelog.d/README.md`) with its `([#<pr>](…/pull/<pr>))` link (without it the fragment parser fails every e2e shard); never edit `CHANGELOG.md`.
- The README is the front door (what, quickstart, links); reference material goes in `docs/` and is linked from it.
- Choose the merge method per PR: merge commit when the commits are meaningful; no squash by default.
- Commit as `13460098+DocGerd@users.noreply.github.com` (repo-local `user.email`), never the owner's real address.
- `main` ruleset (no bypass) requires up-to-date PRs and resolved review threads: after a merge, `gh api -X PUT repos/DocGerd/gegenlenker/pulls/<n>/update-branch` the next one and wait for CI.
- CI runs `lint`, `unit` and `e2e` in parallel; the `main` ruleset requires the aggregate job `check` (needs all three; on push to `main` e2e is skipped and `check` accepts that): keep that job name in `ci.yml`.
- Pin actions to a full commit SHA with a `# vX.Y.Z` comment (repo enforces `sha_pinning_required`); Dependabot keeps them current.
- A push to `main` deploys via `build-pages` and `deploy` (`.github/workflows/ci.yml`), which test `needs.<job>.result == 'success'` explicitly (implicit `success()` counts skipped ancestors); `workflow_dispatch` on `main` is the fallback.
- Merge reviewed PRs with green CI without asking, until the project moves to gitflow and a first release.
