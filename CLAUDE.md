# Gegenlenker

Truck + turntable drawbar trailer maneuvering trainer. TypeScript, Vite, three.js, pnpm (Node 24).

## Verify

Dev server: `pnpm dev`. `pnpm verify` runs the checks below after Install (`test:e2e` builds with `BASE_PATH` itself); run it before every PR.

- Install: `pnpm install --frozen-lockfile`
- Lint: `pnpm lint`; format: `pnpm format:check` (fix with `pnpm format`)
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test`; single test: `pnpm exec vitest run <file> -t '<name>'`
- Build: `BASE_PATH=/gegenlenker/ pnpm build`
- Browser e2e: `pnpm test:e2e` (builds and previews itself unless `CI` is set; once: `pnpm exec playwright install chromium`); it runs only specs matching the `offline` project's `testMatch` in `playwright.config.ts`, so register new specs there.
- Parallel worktrees: e2e previews on `--strictPort` 4399, so serialize with `flock /tmp/gegenlenker-e2e.lock pnpm test:e2e`; a killed run can orphan a preview on 4399 outside the lock (`ss -ltnp | grep 4399`); ad-hoc preview servers need another port and `BASE_PATH=/gegenlenker/`.
- Local-only ignores go in `.git/info/exclude` as unanchored patterns (`dir/`, not `/dir/`); the format scripts pass it to Prettier.

## Layering

- Only `src/render` imports `three`; `.ts` files are checked by `no-restricted-imports` in `eslint.config.js`, `dev/` harnesses are exempt.
- `src/{contracts,vehicles,sim,scoring,content}` also import none of `render/app/hud/input/pwa/i18n` and use none of `window`, `document`, `navigator`, `localStorage`, `performance`, `requestAnimationFrame` (same config).
- Top-down-only drawing: put meshes on `AIDS_LAYER` (`layers.set`); only `topDownCamera` enables it. Cockpit/mirror-only meshes (sky dome, skyline) go on `SKY_LAYER`; cab-front parts on `CAB_LAYER` (mirrors only, the cockpit eye is inside the cab); no current camera frames the cab (#126), so check a frustum before calling a cab change visible. Cameras enable layers via `enableLayers` with `COCKPIT_LAYERS`/`MIRROR_LAYERS`/`TOP_DOWN_LAYERS` (`src/render/seams.ts`).
- Perspective scenery must stay inside `CAMERA_FAR` (`src/render/seams.ts`); `src/render/skyline.test.ts` pins it.
- Obstacle kinds in `RESTYLED_KINDS` (`src/render/yard-props.ts`) draw a token copy top-down only plus a detailed perspective prop; a new kind needs both.
- Vertex colours must be linear: set a `Color` from the palette (`color.set` converts) and pass it to `tint()` (`src/render/environment.ts`); raw palette bytes render too light. `tint()` drops UVs, so textured surfaces need their own geometry and material.
- ESLint is type-aware (`strictTypeChecked`): fix findings in source, no `eslint-disable`.
- The `query(root, name, Type)` DOM helpers (menu, hud, controls) throw unless the element is `instanceof Type`: pass the real class (`SVGElement` for `<svg>`/`<g>`, `HTMLSelectElement` for `<select>`).
- Changing `--scene-*` tokens: keep the T1-T4 contrast targets in `docs/brand/BRAND.md`; `src/styles/tokens.test.ts` enforces them.
- `tokens.test.ts` checks token hex values, not rendered pixels: fog, tone mapping, ground detail or shadows can break top-down contrast unnoticed. Keep top faces on tokens, put realism on perspective-only layers, and check with a top-down screenshot.
- Mirror rects avoid the controls via `controlsHeight()` in `src/render/viewports.ts`, which copies control geometry from `src/input/controls.css` and `src/styles/tokens.css`: change both together. They also avoid the measured HUD legend (`hud.legendBox()` → `LegendBox`); `e2e/layout.spec.ts` pins no overlap.
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
- Use `sourced()` or `estimate()`; never present an estimate as sourced.
- Adding, changing, sourcing or removing an estimate means running `pnpm estimates` (rewrites the README table between the `estimates:` markers); `src/vehicles/estimates.test.ts` fails otherwise.
- Bump `SIM_REVISION` in `src/sim/fingerprint.ts` only for sim, collision or scoring logic changes; `dataFingerprint` already hashes vehicle params, obstacle ids and OBBs, start, exercise, sim constants and scoring thresholds: visual-only prop changes keep stored runs; adding or moving a collision prop invalidates them for that layout.

## Blender assets

- `tools/blender/cab_shell.py` is the source of truth for the cab `.glb`: run it unmodified through the `blender` MCP (`runpy.run_path` on its `wslpath -w` path, `init_globals` `PARAMS_PATH`, `OUT_PATH`), then `pnpm cab:optimise <raw.glb>` and `pnpm cab:manifest "<Blender version>"`.
- After changing cab Params or `src/render/cab-dims.ts`, run `pnpm cab:params` and rebuild; the glb records its input hashes, so `tools/blender/cab-build.test.ts` fails on a manifest regenerated without a rebuild.
- MCP-run bpy scripts must not call `read_factory_settings`: it reloads preferences and disables the MCP add-on.

## Tests

Test logic and critical paths only; no blanket coverage, no tests without value.

- e2e: await web-first assertions (`toHaveCount`, `toBeVisible`; `hudReady()` in `e2e/layout.spec.ts`) before measuring DOM boxes.

## Tablet perf check (manual, reference device: Android tablet, Chrome)

- Open https://docgerd.github.io/gegenlenker/?perf=1 and start a drive (`src/app/drive.ts` mounts the overlay only there); it shows fps, p95 frame ms, resolution scale, draw calls, GL renderer.
- Pass: at least 58 fps at resolution scale 1.00.
- `?probe` mounts `src/render/probe.ts`, which `pnpm test:perf` (`e2e/perf/four-views.perf.ts`; headed, local only, not CI) uses; that spec owns the automated thresholds and skips on software GL (SwiftShader, llvmpipe), so only a real GPU measures fps.
- Also check: two-thumb touch (wheel and lever at once), Android back gesture (history handling in `src/app/app.ts`), offline install, mirror sides.

## Visual check

- Headless Chromium screenshots of the real app work for visual checks (`pnpm exec playwright screenshot --lang de-DE <url> <png>`; scripts reuse the `@playwright/test` devDep); UI language defaults to the browser locale (`navigator.languages`) unless a saved setting overrides it; there is no URL parameter.
- Plain `playwright screenshot` can show a blank canvas under `.hud-band` (software compositing); e2e passes GPU-compositing SwiftShader args in `playwright.config.ts`. Read the canvas back before calling a blank region an app bug.
- Standstill drive screenshots are byte-identical across runs, so before/after can be compared by hash; the sim steps on wall-clock time, so shots after driving differ run to run.
- Headless screenshots run on software GL and passed a see-through skyline; perspective realism changes need an owner device check before calling them done.

## Workflow

- Changes go through PRs; never push to `main`.
- `.claude/settings.json` is committed: a PostToolUse hook (`.claude/hooks/format.sh`) runs Prettier on each Edit/Write, and editing `pnpm-lock.yaml` is denied (change it through pnpm). Review `.claude/**` changes like code.
- Commit and PR titles use conventional prefixes: `feat`, `fix`, `docs`, `ci`, `chore`, `refactor`, `perf`, `test`.
- UI text goes through `t()`; keys live in `src/i18n/en.ts`, and `de.ts` is typed against them, so both must define every key. German UI wording follows `docs/glossary.md`.
- Choose the merge method per PR: merge commit when the commits are meaningful; no squash by default.
- Commit as `13460098+DocGerd@users.noreply.github.com` (repo-local `user.email`), never the owner's real address.
- `main` ruleset (no bypass) requires up-to-date PRs and resolved review threads: after a merge, `gh api -X PUT repos/DocGerd/gegenlenker/pulls/<n>/update-branch` the next one and wait for CI.
- Pin actions to a full commit SHA with a `# vX.Y.Z` comment (repo enforces `sha_pinning_required`); Dependabot keeps them current.
- A push to `main` deploys via the gated `build-pages` and `deploy` jobs in `.github/workflows/ci.yml`; `workflow_dispatch` on `main` is the fallback.
- Merge reviewed PRs with green CI without asking, until the project moves to gitflow and a first release.
