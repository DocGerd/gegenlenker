# Gegenlenker

Truck + turntable drawbar trailer maneuvering trainer. TypeScript, Vite, three.js, pnpm (Node 24).

## Verify

Dev server: `pnpm dev`. CI runs the rest in order (`.github/workflows/ci.yml`); run them before every PR.

- Install: `pnpm install --frozen-lockfile`
- Lint: `pnpm lint`; format: `pnpm format:check` (fix with `pnpm format`)
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test`
- Build: `BASE_PATH=/gegenlenker/ pnpm build`
- Browser e2e: `pnpm test:e2e` (builds and previews itself unless `CI` is set; once: `pnpm exec playwright install chromium`)

## Layering

- Only `src/render` imports `three`; `.ts` files are checked by `no-restricted-imports` in `eslint.config.js`, `dev/` harnesses are exempt.
- `src/{contracts,vehicles,sim,scoring,content}` also import none of `render/app/hud/input/pwa/i18n` and use none of `window`, `document`, `navigator`, `localStorage`, `performance`, `requestAnimationFrame` (same config).
- Top-down-only drawing: put meshes on `AIDS_LAYER` (`layers.set`); only `topDownCamera` enables it, so cockpit and mirrors never see them.
- Vertex colours go through `tint()` (`src/render/environment.ts`, sRGB to linear); raw palette bytes render too light.
- Changing `--scene-*` tokens: keep the T1-T3 contrast targets in `docs/brand/BRAND.md`; `src/styles/tokens.test.ts` enforces them.

## Units and signs

- Sim: metres, radians, seconds; vehicle data (`src/contracts/vehicle.ts`): mm, degrees, turns/s.
- Sim plane: heading 0 points along the x axis, counter-clockwise positive, so positive heading is a left turn; body frame is x forward, y left, z up.
- Three space (`src/render/coords.ts`): x = x, z = -y, y up, `rotation.y` = heading.
- `ControlVector.steer` is the target, -1 (full right) to 1 (full left), rate-limited in the snapshot; `lever` is 0 to 1 of the speed cap; direction comes from `gear` (`R` gives negative speed).
- `couplingAngle` = truck heading - drawbar heading; `turntableAngle` = drawbar heading - trailer heading.
- Reversing with left steer, the trailer rear first goes LEFT (double inversion); no test pins this, so re-check it after changing vehicle data.

## Vehicle data

- Every numeric vehicle dimension is a `Param` (`id`, `name`, `body` are not) with `status` `'sourced'` (`source` is an https URL from `src/vehicles/sources.ts`) or `'estimate'` (`source` is the basis).
- Use `sourced()` or `estimate()`; never present an estimate as sourced.
- Adding, changing, sourcing or removing an estimate means updating the README table between the `estimates:` markers to match `estimatesTable()`; `src/vehicles/estimates.test.ts` fails otherwise.
- Bump `SIM_REVISION` in `src/sim/fingerprint.ts` only for sim, collision or scoring logic changes; `dataFingerprint` already hashes vehicle params, obstacles, start, exercise, sim constants and scoring thresholds.

## Tests

Test logic and critical paths only; no blanket coverage, no tests without value.

## Tablet perf check (manual, reference device: Android tablet, Chrome)

- Open https://docgerd.github.io/gegenlenker/?perf=1 and start a drive (`src/app/drive.ts` mounts the overlay only there); it shows fps, p95 frame ms, resolution scale, draw calls, GL renderer.
- Pass: at least 58 fps at resolution scale 1.00. `pnpm test:perf` (`e2e/perf/four-views.perf.ts`; headed, local only, not CI) owns the automated thresholds; it skips on software GL (SwiftShader, llvmpipe), so only a real GPU measures fps.
- Headless Chromium screenshots of the real app work for visual checks; UI language follows the browser locale (`navigator.languages`), not a URL parameter.
- Also check: two-thumb touch (wheel and lever at once), Android back gesture (history handling in `src/app/app.ts`), offline install, mirror sides.

## Workflow

- Changes go through PRs; never push to `main`.
- Commit and PR titles use conventional prefixes: `feat`, `fix`, `docs`, `ci`, `chore`, `refactor`, `perf`, `test`.
- UI text goes through `t()`; keys live in `src/i18n/en.ts`, and `de.ts` is typed against them, so both must define every key.
- Choose the merge method per PR: merge commit when the commits are meaningful; no squash by default.
- Commit as `13460098+DocGerd@users.noreply.github.com` (repo-local `user.email`), never the owner's real address.
- `main` requires PRs to be up to date: after a merge, `gh api -X PUT repos/DocGerd/gegenlenker/pulls/<n>/update-branch` the next one and wait for CI.
- Merge reviewed PRs with green CI without asking, until the project moves to gitflow and a first release.
