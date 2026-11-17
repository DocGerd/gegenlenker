# Gegenlenker

Truck + turntable drawbar trailer maneuvering trainer. TypeScript, Vite, three.js, pnpm (Node 24).

## Verify

CI runs these in order (`.github/workflows/ci.yml`); run them before every PR.

- Install: `pnpm install --frozen-lockfile`
- Dev server: `pnpm dev`
- Lint: `pnpm lint`; format: `pnpm format:check` (fix with `pnpm format`)
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test`
- Build: `BASE_PATH=/gegenlenker/ pnpm build`
- Browser e2e: `pnpm test:e2e` (needs the build above; once: `pnpm exec playwright install chromium`)

## Layering

- Only `src/render` imports `three`; `eslint.config.js` enforces it (`no-restricted-imports`), `dev/` harnesses are exempt.
- `src/{contracts,vehicles,sim,scoring,content}` also import no UI layers and use no DOM globals (same config).

## Units and signs

- Sim: metres, radians, seconds; vehicle data (`src/contracts/vehicle.ts`): mm, degrees, turns/s.
- Sim plane: x forward, y left, heading counter-clockwise from +x, so positive heading is a left turn.
- Three space: `z = -y` (`src/render/coords.ts`).
- `steer` is -1 (full right) to 1 (full left); `lever` is 0 to 1; reverse is negative speed.
- `couplingAngle` = truck heading - drawbar heading; `turntableAngle` = drawbar heading - trailer heading.
- Reversing with left steer, the trailer rear first goes LEFT (double inversion); checked by simulating the MAN + Krone pair.

## Vehicle data

- Every vehicle value is a `Param` with `status` `'sourced'` (`source` is a URL from `src/vehicles/sources.ts`) or `'estimate'` (`source` is the basis).
- Use `sourced()` or `estimate()`; never present an estimate as sourced.
- Adding or changing an estimate means updating the README table between the `estimates:` markers to match `estimatesTable()`; `src/vehicles/estimates.test.ts` fails otherwise.
- Bump `SIM_REVISION` in `src/sim/fingerprint.ts` when simulation, collision or scoring behaviour changes; the data fingerprint tells stored runs apart.

## Tests

Test logic and critical paths only; no blanket coverage, no tests without value.

## Tablet perf check (manual, reference device: Android tablet, Chrome)

- Open the live site with `?perf=1`; the overlay shows fps, p95 frame ms, resolution scale, draw calls, GL renderer.
- Pass: at least 58 fps at resolution scale 1.00.
- Also check: two-thumb touch (wheel and lever at once), Android back gesture, offline install, mirror sides.

## Workflow

- Changes go through PRs; never push to `main`.
- Choose the merge method per PR: merge commit when the commits are meaningful; no squash by default.
