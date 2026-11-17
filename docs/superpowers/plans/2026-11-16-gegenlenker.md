# Gegenlenker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline-capable browser trainer for maneuvering a truck with a turntable drawbar trailer, above all reversing, with cockpit, two mirrors and top-down view on one canvas.

**Architecture:** Four layers: typed vehicle data (mm/deg, sourced or estimated), then a pure deterministic TypeScript simulation (kinematic off-axle model, 2D collision, rejected steps), then a Three.js presentation behind `SceneRenderer` / `VehicleVisual` / `Environment` / `AidsLayer` seams, then a vanilla-DOM app shell (input mapping, HUD, flow, i18n, storage, PWA). Only `src/render/**` imports Three.js.

**Tech Stack:** Vite 8, TypeScript ~6.0 strict, three 0.187 (`WebGLRenderer`), vite-plugin-pwa 2.0 + workbox-window, @fontsource/geist + geist-mono 5.3, Vitest 5, Playwright 1.65, ESLint 10 + typescript-eslint, Prettier, pnpm, Node 24, GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-11-16-gegenlenker-design.md`

## Global Constraints

- Root `/home/pkuhn/truck-maneuver-sim`; public repo `DocGerd/gegenlenker`, Apache-2.0; Pages at `https://docgerd.github.io/gegenlenker/`.
- Vite `base` = `process.env.BASE_PATH ?? '/'`; deploy, CI build checks and e2e use `BASE_PATH=/gegenlenker/`. No absolute `/` asset URLs in code; use `import.meta.env.BASE_URL`.
- Single package, no workspace, no UI framework. Only Task 1 edits `package.json` / `pnpm-lock.yaml`; a task that needs another dependency stops and reports.
- Lint-enforced layering: only `src/render/**` imports `three`; `src/{contracts,vehicles,sim,scoring,content}/**` use no DOM globals and import nothing from `render`, `app`, `hud`, `input`, `pwa`, `i18n`.
- Units: vehicle data files in mm and degrees (steering rate in turns/s); everything after `resolveCombination` (sim, content, scoring, render) in m, s, rad. Exception: `Tolerances.angle`, `targetError().angle` and `RunResult.angleError` are in degrees.
- World frame: x east, y north, heading CCW from +x. Body frame: origin at the body's reference point, x forward, y left, z up.
- Reference points: truck = rear-axle centre; dolly = turntable centre (over the dolly axle); trailer body = effective rear-axle centre (tandem centre).
- Signs: `steer` and `roadWheelAngle` > 0 = left; `speed` > 0 = forward; `couplingAngle` = truck heading − dolly heading; `turntableAngle` = dolly heading − trailer heading; all angles wrapped to (−π, π].
- Three mapping: world (x, y, up) → Three `(x, up, −y)`; `object.rotation.y = heading`. Top-down is north-up.
- Left-hand drive only: one eye point per truck, left of centre; no RHD switch or parameter.
- German and English only, two flat message files `src/i18n/de.ts` and `src/i18n/en.ts`; no further locale machinery. Task 5 defines every key; other tasks only consume keys.
- Accessibility: keep WCAG 2.1 AA colour contrast (token test); no screen-reader, ARIA-audit, audio or reduced-motion work and no a11y tests.
- Brand: neutral core, Geist / Geist Mono (self-hosted, latin subset), 8-pt spacing, radii unchanged; one accent (teal); light/dark via `data-theme` on `<html>`; numbers, units and keys in mono; footer `© 2026 Patrick Kuhn`. No THW look: no ultramarine, insignia or organisation names in the UI.
- Colours only from `src/styles/tokens.css`; the 3D scene reads `--scene-*` tokens at runtime (`readScenePalette`). Scene in neutral greys; accent only for target and guidance.
- No runtime request leaves the origin; all assets precached; an exercise runs offline after one visit.
- Performance: four views per frame at 60 fps on the reference tablet (Android, Chrome); degrade resolution (floor 0.5) before frame rate.
- Estimates are flagged `status: 'estimate'` in data, listed in the README, and the menu says some dimensions are estimates.
- Tests only for simulation core, collision, scoring, vehicle-data validation (including README estimates sync), token values, content drivability (Task 18), one Playwright offline check, and the scripted local perf check (Task 6). Visuals, styling and glue get the stated manual or scripted verification instead. Unit tests sit next to the code (`*.test.ts`, Vitest node environment).
- Prose and comments minimal everywhere (code, commits, PR bodies, docs, README): a comment only for a non-obvious why; never restate code; no decaying facts (counts, timings, dates, measured figures) unless a requirement.
- Delivery: one branch per task `task/<n>-<slug>` → PR to `main` (`Closes #<n>` when an issue exists). Only Task 1 pushes to `main` directly. Never `--no-verify`, never force-push. Before every push: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`.
- `dev/*.html` pages are manual-verification harnesses: served by `pnpm dev`, never built (the build input is `index.html` only).
- Verified decisions:
  - Renderer: `WebGLRenderer`. The manual calls it "still maintained and the recommended choice for pure WebGL 2 applications" and `WebGPURenderer` "still in an experimental state", sometimes slower; a swap later stays behind `SceneRenderer`. https://threejs.org/manual/pages/webgpurenderer.html
  - Four views: one canvas, one renderer, `autoClear = false`; clear once with the scissor test off, then per view `setScissorTest(true)`, `setViewport` + `setScissor` in logical pixels from the bottom-left, camera aspect per view. https://threejs.org/manual/pages/multiple-scenes.html, https://threejs.org/docs/pages/WebGLRenderer.html
  - Mirrors: render each mirror camera unflipped into a `WebGLRenderTarget`, then draw a quad whose uv has u → 1 − u into the mirror rect. Culling needs no correction because no 3D pass is mirrored. A flipped projection matrix would render inside out: three.js reverses winding only for meshes whose world matrix has a negative determinant (`frontFaceCW` in `WebGLRenderer.js`), and the docs do not cover this. https://github.com/mrdoob/three.js/blob/r187/src/renderers/WebGLRenderer.js
  - PWA: vite-plugin-pwa `base` and `scope` default to Vite's `base`; the manifest sets `id`, `start_url` and `scope` to the base explicitly. `registerType: 'prompt'` with `registerSW` from `virtual:pwa-register`, and `updateSW()` runs only on the user's click. `globPatterns` gains `svg,png,woff2,webmanifest` (the default precache is js/css/html). https://github.com/vite-pwa/vite-plugin-pwa/blob/v2.0.0/src/types.ts, https://vite-pwa-org.netlify.app/guide/prompt-for-update, https://vite-pwa-org.netlify.app/guide/service-worker-precache
  - Fonts: explicit subset imports `@fontsource/geist/latin-<weight>.css`, so only latin files are emitted and precached. https://fontsource.org/docs/getting-started/subsets
  - Headless e2e WebGL: Chromium `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`, for tests only (automatic SwiftShader fallback is deprecated). https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md

## Review Focus

- Gear flipped D → R while rolling: the vehicle slows through zero and reverses, and one direction change is counted (Task 13 test).
- App resumed after being backgrounded (seconds-long frame gap): the sim advances at most `MAX_STEPS_PER_FRAME` steps, so nothing jumps (Task 13 test).
- Driver keeps the lever latched into a wall or a pivot limit: the vehicle stays put, counts one event per blocked episode, and drives away the other way (Task 13 test).
- Docking flush against the ramp (zero gap): touching is not a contact (Task 8 test).
- Stored best results or last run corrupt, partial or from another version: the app starts with them empty, never crashes (Task 9 and Task 13 tests).

## Task Graph

| # | Task | Depends on | Parallel with |
|---|---|---|---|
| 1 | Bootstrap repo, tooling, CI | — | — |
| 2 | Shared contracts | 1 | 3, 4, 5 |
| 3 | Pages deploy workflow | 1 | 2, 4, 5 |
| 4 | Theming, teal accent, fonts, mark | 1 | 2, 3, 5 |
| 5 | i18n message files | 1 | 2, 3, 4 |
| 6 | Renderer spike: four views at 60 fps | 2, 4 | 7–12 |
| 7 | Vehicle data, validation, resolution | 2 | 6, 8–12 |
| 8 | Collision | 2 | 6, 7, 9–12 |
| 9 | Scoring and best results | 2 | 6–8, 10–12 |
| 10 | Yards, street, exercises | 2 | 6–9, 11, 12 |
| 11 | PWA and update prompt | 1, 4, 5 | 6–10, 12 |
| 12 | Input mapping and controls | 2, 4, 5 | 6–11 |
| 13 | Simulation core | 2, 7 | 8–12, 14–17 |
| 14 | Procedural vehicle visuals | 6, 7 | 13, 15–18 |
| 15 | Environment and top-down aids | 6, 10 | 13, 14, 16–18 |
| 16 | HUD | 2, 4, 5, 6 | 13–15, 17, 18 |
| 17 | README with estimated parameters | 7 | 13–16, 18 |
| 18 | Every pair drives in every layout and exercise | 7, 8, 9, 10, 13 | 14–17 |
| 19 | App shell: menu, settings, drive loop | 6–16, 18 | — |
| 20 | Results and replay | 19 | 21 |
| 21 | Offline browser check | 11, 19 | 20 |
| 22 | Final verification against the Definition of done | all | — |

Parallel tasks have disjoint file allowlists (each task's **Files** block).

---

### Task 1: Bootstrap repo, tooling, CI

**Depends on:** — · **Parallel with:** —

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `index.html`, `src/main.ts`, `src/vite-env.d.ts`, `LICENSE`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: scripts `dev`, `build`, `preview`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:e2e`, `test:perf`, `icons`; Playwright projects `offline` and `perf`; `<div id="app">` in `index.html`.

- [ ] **Step 1: Initialise git and the package**

`git init -b main`. `package.json`: `"name": "gegenlenker"`, `"private": true`, `"type": "module"`, `"engines": {"node": ">=24"}`, `"packageManager": "pnpm@<output of pnpm --version>"`. Scripts: `dev` `vite`; `build` `vite build`; `preview` `vite preview`; `lint` `eslint .`; `format` `prettier --write .`; `format:check` `prettier --check .`; `typecheck` `tsc --noEmit`; `test` `vitest run`; `test:e2e` `playwright test --project offline`; `test:perf` `playwright test --project perf`; `icons` `node scripts/icons.mjs`.

- [ ] **Step 2: Install every dependency the plan uses**

```bash
pnpm add three@^0.187.0 @fontsource/geist@^5.3.0 @fontsource/geist-mono@^5.3.0 workbox-window@^7.4.1
pnpm add -D typescript@~6.0.3 vite@^8.3.8 vite-plugin-pwa@^2.0.0 vitest@^5.1.0 @playwright/test@^1.65.1 \
  eslint@^10.15.0 @eslint/js@^10.0.1 typescript-eslint@^8.73.0 prettier@^3.10.1 @types/three@^0.187.0 @types/node@^24
```

- [ ] **Step 3: Write the configs**

- `tsconfig.json`: target ES2022, module ESNext, moduleResolution Bundler, lib `ES2022, DOM, DOM.Iterable`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `skipLibCheck`, `noEmit`, types `["vite/client", "node"]`; include `src`, `e2e`, `dev`, `*.config.ts`.
- `eslint.config.js`: `@eslint/js` recommended + `tseslint.configs.strict`. Flat config replaces, not merges, a rule's options across matching blocks, so `no-restricted-imports` appears in exactly two mutually exclusive blocks:
  - Files outside `src/render/**` and outside the core folders: bans `three`, `three/*` ("Only src/render imports Three.js").
  - Core `src/{contracts,vehicles,sim,scoring,content}/**`: one entry banning `three`, `three/*`, `**/render/**`, `**/app/**`, `**/hud/**`, `**/input/**`, `**/pwa/**`, `**/i18n/**`; plus `no-restricted-globals` for `window`, `document`, `navigator`, `localStorage`, `performance`, `requestAnimationFrame`.
  - `type` imports from `three` in `src/render/seams.ts` are inside `src/render/**`, so they are allowed. Ignore `dist`, `node_modules`.
- `.prettierrc.json`: `{ "singleQuote": true, "printWidth": 100 }`; `.prettierignore`: `dist`, `pnpm-lock.yaml`, `public/licenses`.
- `.gitignore`: `node_modules/`, `dist/`, `test-results/`, `playwright-report/`, `.remember/`, `.claude/settings.local.json`.
- `vite.config.ts`: `defineConfig({ base: process.env.BASE_PATH ?? '/', build: { assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined) } })`.
- `vitest.config.ts`: `include: ['src/**/*.test.ts']`, `environment: 'node'`, `passWithNoTests: true`.
- `playwright.config.ts`: `testDir: 'e2e'`, `workers: 1`, `retries: 0`, `forbidOnly: !!process.env.CI`. Projects: `offline` (`testMatch: /offline\.spec\.ts$/`, `...devices['Desktop Chrome']`, viewport 1280×800, `locale: 'en-US'`, `serviceWorkers: 'allow'`, launch args `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`) and `perf` (`testMatch: /\.perf\.ts$/`, `...devices['Galaxy Tab S9 landscape']`, `headless: false`, launch args `--ignore-gpu-blocklist`, timeout 120 s). `webServer`: `command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4399 --strictPort'`, `env: { BASE_PATH: '/gegenlenker/' }`, `url: 'http://127.0.0.1:4399/gegenlenker/'`; `use.baseURL` the same URL.
- `index.html`: `<html lang="de">`, `<meta charset="utf-8" />`, viewport `width=device-width, initial-scale=1, viewport-fit=cover`, `<title>Gegenlenker</title>`, `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`, `<div id="app"></div>`, `<script type="module" src="/src/main.ts"></script>`.
- `src/vite-env.d.ts`: `/// <reference types="vite/client" />`. `src/main.ts`: sets `#app` text to `Gegenlenker` (placeholder until Task 6).
- `LICENSE`: Apache-2.0 text from `gh api /licenses/apache-2.0 --jq .body`, copyright line `Copyright 2026 Patrick Kuhn`.
- `.github/workflows/ci.yml`: on `pull_request` and push to `main`; `permissions: contents: read`; job `check` (ubuntu-latest, timeout 20): `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7.1.0` (node 24, cache pnpm), `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

- [ ] **Step 4: Verify locally**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && BASE_PATH=/gegenlenker/ pnpm build && grep -q 'src="/gegenlenker/assets/' dist/index.html`
Expected: exit 0.

- [ ] **Step 5: Create the repo and push the bootstrap commit**

```bash
git add -A && git commit -m "chore: bootstrap gegenlenker"
gh repo create DocGerd/gegenlenker --public --source . --push --description "Reversing trainer for a truck with a turntable drawbar trailer"
gh run watch --exit-status "$(gh run list --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```
Expected: CI `check` passes. `git add -A` is safe only here: verify `git status` shows no `.remember/` or `.claude/settings.local.json` before committing.

- [ ] **Step 6: Protect `main`**

Create a ruleset on `main` requiring a pull request (0 approvals) and the status check `check`, no bypass except repository admins: `gh api -X POST repos/DocGerd/gegenlenker/rulesets --input <ruleset.json>`. Verify: `gh api repos/DocGerd/gegenlenker/rulesets --jq '.[].name'` lists it.

---

### Task 2: Shared contracts

**Depends on:** 1 · **Parallel with:** 3, 4, 5

**Files:**
- Create: `src/contracts/vehicle.ts`, `src/contracts/sim.ts`, `src/contracts/layout.ts`, `src/contracts/exercise.ts`, `src/contracts/render.ts`, `src/render/seams.ts`, `src/vehicles/anchors.ts`, `src/sim/angle.ts`

**Interfaces:**
- Produces: every type below; the id lists `TRUCK_IDS`, `TRAILER_IDS`, `LAYOUT_IDS`, `EXERCISE_IDS`; `truckAnchors`, `trailerAnchors`, `COUPLING_HEIGHT`, `AIDS_LAYER`; `wrapAngle(a: number): number` (`src/sim/angle.ts`, result in (−π, π]). Every later task imports these by these paths and names.

- [ ] **Step 1: Write the contract files exactly**

Every object-type property below is `readonly` in the code (omitted here for brevity); arrays are `readonly T[]`. Comments mark units or meaning only where the name cannot.

```ts
// src/contracts/vehicle.ts — data in mm, degrees, turns per second
export type ParamStatus = 'sourced' | 'estimate';
export type Param = { value: number; status: ParamStatus; source: string }; // source: URL if sourced, basis if estimated
export const TRUCK_IDS = ['man-le-18-280', 'arocs-1835-ak'] as const;
export const TRAILER_IDS = ['krone-azw-18', 'hueffermann-hpa-24-81-l'] as const;
export type TruckId = (typeof TRUCK_IDS)[number];
export type TrailerId = (typeof TRAILER_IDS)[number];
export type TruckBody = 'platform' | 'tipper';
export type TrailerBody = 'box' | 'low-loader';
export type TruckSpec = {
  id: TruckId; name: string; body: TruckBody;
  wheelbase: Param; frontOverhang: Param /* front axle → bumper */; rearOverhang: Param /* rear axle → rear end */;
  length?: Param; width: Param; frontTrack: Param; rearTrack: Param;
  couplingOffset: Param /* rear axle → coupling pin, rearward */; turningRadius: Param /* outer front wheel, full lock */;
  eye: { height: Param; behindBumper: Param; leftOfCentre: Param };
  mirror: { lateral: Param /* pivot from centreline */; glassOutboard: Param; behindBumper: Param; height: Param };
  steering: { lockToLockTurns: Param; maxRate: Param };
};
export type TrailerSpec = {
  id: TrailerId; name: string; body: TrailerBody;
  drawbar: Param /* eye → turntable centre */; wheelbase: Param /* turntable → effective rear axle */;
  rearAxleCount: Param; rearAxleSpacing?: Param;
  frontOverhang: Param /* turntable → body front */; rearOverhang: Param /* effective rear axle → body rear */;
  lengthToEye?: Param; width: Param; track: Param; deckHeight: Param;
  couplingLimit: Param; turntableLimit: Param;
};
/** Metres and radians; distances positive; steerRate in steer units (−1…1) per second. */
export type VehicleParams = {
  wheelbase: number; couplingOffset: number; maxRoadWheelAngle: number; steerRate: number; frontTrack: number;
  truckFront: number /* rear axle → bumper */; truckRear: number /* rear axle → rear end */; truckWidth: number;
  drawbar: number; trailerWheelbase: number;
  trailerFrontOverhang: number; trailerRearOverhang: number; trailerWidth: number;
  couplingLimit: number; turntableLimit: number;
};
export type Vec3 = { x: number; y: number; z: number };
/** Truck body frame, metres. */
export type TruckAnchors = {
  frontAxle: Vec3; rearAxle: Vec3; coupling: Vec3; eye: Vec3; mirrorLeft: Vec3; mirrorRight: Vec3;
  frontX: number; rearX: number;
};
/** eye and frontAxle in the dolly frame; the rest in the trailer body frame. */
export type TrailerAnchors = { eye: Vec3; frontAxle: Vec3; turntable: Vec3; rearAxles: Vec3[]; frontX: number; rearX: number };
```

```ts
// src/contracts/sim.ts
export type Vec2 = { x: number; y: number };
export type Pose2 = { x: number; y: number; heading: number };
export type Gear = 'P' | 'R' | 'N' | 'D';
/** steer: target wheel position, −1 full right … 1 full left; lever: 0 … 1 of the speed cap. */
export type ControlVector = { steer: number; lever: number; brake: boolean; gear: Gear };
export type BodyId = 'truck' | 'drawbar' | 'trailer';
export type BlockReason = 'coupling' | 'turntable' | 'contact';
export type Obb = { cx: number; cy: number; halfLength: number /* along heading */; halfWidth: number; heading: number };
export type BodyFootprint = { body: BodyId; obb: Obb };
export type SimContact = { body: BodyId; obstacleId: string }; // 'self': truck against trailer body
export type ContactQuery = (bodies: readonly BodyFootprint[]) => SimContact | null;
export type StartState = { truck: Pose2; couplingAngle?: number; turntableAngle?: number };
export type SimSnapshot = {
  step: number; time: number;
  truck: Pose2; coupling: Vec2; dolly: Pose2; trailer: Pose2; trailerRear: Vec2;
  couplingAngle: number; turntableAngle: number;
  steer: number; roadWheelAngle: number; speed: number; control: ControlVector;
  blocked: BlockReason | null; contacts: number; jackknifes: number; directionChanges: number;
};
export type Simulation = { step(control: ControlVector): SimSnapshot; snapshot(): SimSnapshot };
export type InputChange = { step: number; control: ControlVector };
```

```ts
// src/contracts/layout.ts
import type { TargetZone } from './exercise';
import type { Obb, Pose2, Vec2 } from './sim';
export type Rect2 = { minX: number; minY: number; maxX: number; maxY: number };
export type ObstacleKind = 'kerb' | 'wall' | 'fence' | 'hall' | 'ramp' | 'lamp' | 'parked' | 'cone';
export type Obstacle = { id: string; kind: ObstacleKind; obb: Obb; height: number };
export type MarkingKind = 'lane-centre' | 'lane-edge' | 'bay' | 'stop';
export type Marking = { kind: MarkingKind; from: Vec2; to: Vec2; width: number; dashed: boolean };
export type SurfaceKind = 'yard' | 'pavement' | 'street';
export type Surface = { kind: SurfaceKind; rect: Rect2 };
/** Street along x, south of the yard; kerbY is the yard-side kerb line. */
export type StreetSpec = {
  kerbY: number; width: number; pavement: number; fromX: number; toX: number;
  entrance: { fromX: number; toX: number };
};
export const LAYOUT_IDS = ['depot', 'logistics'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];
export type Layout = {
  id: LayoutId; bounds: Rect2; yard: Rect2; street: StreetSpec; start: Pose2;
  obstacles: Obstacle[]; markings: Marking[];
};
export type ResolvedLayout = {
  id: LayoutId; bounds: Rect2; yard: Rect2; surfaces: Surface[];
  obstacles: Obstacle[]; markings: Marking[]; target: TargetZone | null;
};
```

```ts
// src/contracts/exercise.ts
import type { LayoutId, Marking, Obstacle } from './layout';
import type { InputChange, Pose2, Vec2 } from './sim';
import type { TrailerId, TruckId } from './vehicle';
export const EXERCISE_IDS = ['straight-reverse', 'reverse-bay', 'reverse-corner', 'dock-ramp', 'slalom'] as const;
export type ExerciseId = (typeof EXERCISE_IDS)[number];
/** pose: trailer rear-end centre and trailer heading at the goal; the drawn zone extends `length` along pose.heading. */
export type TargetZone = { pose: Pose2; length: number; width: number };
export type Tolerances = { position: number /* m */; angle: number /* degrees */ };
export type ExerciseDefinition = {
  id: ExerciseId; layout: LayoutId; start: Pose2; target: TargetZone; tolerances: Tolerances;
  waypoint: Vec2 | null; obstacles: Obstacle[]; markings: Marking[];
};
export type RunResult = {
  exerciseId: ExerciseId; truckId: TruckId; trailerId: TrailerId; reached: boolean;
  positionError: number; angleError: number; contacts: number; jackknifes: number;
  directionChanges: number; time: number;
};
export type BestResults = Readonly<Record<string, RunResult>>;
export type InputLog = {
  version: 1; layoutId: LayoutId; exerciseId: ExerciseId | null; truckId: TruckId; trailerId: TrailerId;
  steps: number; changes: InputChange[];
};
```

```ts
// src/contracts/render.ts
import type { ResolvedLayout } from './layout';
import type { SimSnapshot, Vec2 } from './sim';
import type { TrailerSpec, TruckSpec } from './vehicle';
export type Rect = { x: number; y: number; width: number; height: number }; // CSS px, top-left origin
export type ViewRects = { cockpit: Rect | null; mirrorLeft: Rect | null; mirrorRight: Rect | null; topDown: Rect };
export type ViewMode = 'drive' | 'replay';
export type TopDownMode = 'follow' | 'yard';
export type AidFlags = { pivots: boolean; path: boolean; tracks: boolean; ghost: boolean };
export type ScenePaletteKey =
  | 'sky' | 'verge' | 'yard' | 'pavement' | 'street' | 'marking' | 'kerb' | 'wall' | 'fence' | 'hall'
  | 'ramp' | 'lamp' | 'parked' | 'cone' | 'cab' | 'body' | 'chassis' | 'wheel' | 'tracks' | 'accent';
export type ScenePalette = Readonly<Record<ScenePaletteKey, number>>;
export type RenderFrame = { snapshot: SimSnapshot; views: ViewRects; topDown: TopDownMode; aids: AidFlags; predicted: Vec2[] };
export type RenderStats = {
  fps: number; frameP95Ms: number; resolutionScale: number; drawCalls: number; glRenderer: string; contextLost: boolean;
};
export interface SceneRenderer {
  init(canvas: HTMLCanvasElement): void; // throws when WebGL 2 is unavailable
  setScene(layout: ResolvedLayout, truck: TruckSpec, trailer: TrailerSpec, palette: ScenePalette): void;
  resize(cssWidth: number, cssHeight: number): void;
  render(frame: RenderFrame): void;
  stats(): RenderStats;
  dispose(): void;
}
```

```ts
// src/render/seams.ts
import type { Object3D } from 'three';
import type { ResolvedLayout } from '../contracts/layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
export const AIDS_LAYER = 1; // seen by the top-down camera only
export interface VehicleVisual { readonly object: Object3D; update(snapshot: SimSnapshot): void; dispose(): void }
export interface Environment { readonly object: Object3D; dispose(): void } // ground, markings, obstacles, lights
export interface AidsLayer { readonly object: Object3D; update(frame: RenderFrame): void; dispose(): void }
export type RendererParts = {
  truck: (spec: TruckSpec, palette: ScenePalette) => VehicleVisual;
  trailer: (spec: TrailerSpec, palette: ScenePalette) => VehicleVisual;
  environment: (layout: ResolvedLayout, palette: ScenePalette) => Environment;
  aids: (truck: TruckSpec, trailer: TrailerSpec, layout: ResolvedLayout, palette: ScenePalette) => AidsLayer;
};
```

- [ ] **Step 2: Implement anchors in `src/vehicles/anchors.ts`**

`export const COUPLING_HEIGHT = 0.9;` `truckAnchors(spec: TruckSpec): TruckAnchors` and `trailerAnchors(spec: TrailerSpec): TrailerAnchors`, all mm → m. With `L` = wheelbase and `F` = L + frontOverhang:
- Truck: `rearAxle (0,0,0)`, `frontAxle (L,0,0)`, `coupling (−couplingOffset, 0, COUPLING_HEIGHT)`, `frontX = F`, `rearX = −rearOverhang`, `eye (F − eye.behindBumper, +eye.leftOfCentre, eye.height)`, `mirrorLeft/Right (F − mirror.behindBumper, ±(mirror.lateral + mirror.glassOutboard), mirror.height)`.
- Trailer: `eye (drawbar, 0, COUPLING_HEIGHT)` and `frontAxle (0,0,0)` in the dolly frame; `turntable (wheelbase, 0, 0)`, `rearAxles` front axle first: `[0]` (one axle) or `[+spacing/2, −spacing/2]` (two), `frontX = wheelbase + frontOverhang`, `rearX = −rearOverhang` in the body frame.

- [ ] **Step 3: Implement `wrapAngle` in `src/sim/angle.ts`** — maps any angle to (−π, π]; `wrapAngle(π) === π`, `wrapAngle(−π) === π`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0. (Task 7 tests the anchors against vehicle data.)

- [ ] **Step 5: Deliver** — PR `feat: shared contracts` from `task/2-contracts`.

---

### Task 3: Pages deploy workflow

**Depends on:** 1 · **Parallel with:** 2, 4, 5

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Write `deploy.yml`**

On push to `main` and `workflow_dispatch`; `permissions: contents: read`; `concurrency: { group: pages, cancel-in-progress: false }`. Job `build`: checkout@v7, pnpm/action-setup@v6, setup-node@v7.1.0 (node 24, cache pnpm), `pnpm install --frozen-lockfile`, `pnpm build` with `env: BASE_PATH: /gegenlenker/`, step `grep -q 'src="/gegenlenker/assets/' dist/index.html`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5` (path `dist`). Job `deploy` (needs build; `permissions: pages: write, id-token: write`; `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`): `actions/deploy-pages@v5` with `id: deployment`.

- [ ] **Step 2: Enable Pages from Actions**

Run: `gh api -X POST repos/DocGerd/gegenlenker/pages -f build_type=workflow`
Expected: JSON with `"build_type": "workflow"` (a 409 means Pages exists: set it with `-X PUT` instead).

- [ ] **Step 3: Deliver** — PR `ci: deploy to GitHub Pages` from `task/3-deploy`.

- [ ] **Step 4: Verify after merge**

Run: `gh run watch --exit-status <deploy run id> && curl -fsS https://docgerd.github.io/gegenlenker/ | grep -q '/gegenlenker/assets/'`
Expected: exit 0.

---

### Task 4: Theming, teal accent, fonts, mark

**Depends on:** 1 · **Parallel with:** 2, 3, 5

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/tokens.test.ts`, `src/styles/base.css`, `src/styles/fonts.ts`, `docs/brand/BRAND.md`, `public/favicon.svg`, `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/pwa-maskable-512x512.png`, `public/licenses/geist-OFL.txt`, `scripts/icons.mjs`

**Interfaces:**
- Produces: CSS custom properties below; `src/styles/fonts.ts` (side-effect imports); `src/styles/base.css`; `--scene-<key>` for every `ScenePaletteKey` (Task 2), theme-independent, in `:root` only.

Derived teal values. Each takes the OKLCH lightness and chroma of its brand-azure counterpart and teal's hue 184.8°, with chroma reduced until the colour is in the sRGB gamut:

| Token | Light | Dark |
|---|---|---|
| `--color-accent` | `#0f7c72` (brand) | `#01afa1` |
| `--color-accent-strong` | `#01625a` | `#60c1b5` |
| `--color-accent-tint` | `#e8f3f1` | `#0e2623` |
| `--color-on-accent` | `#ffffff` | `#0d0e10` |

Text on `--color-accent-tint` is only `--color-text` or `--color-accent-strong`: `#0f7c72` on `#e8f3f1` is 4.47:1. In dark, on-accent must be `#0d0e10`, because white on `#01afa1` is 2.75:1.

- [ ] **Step 1: Write the failing token test `src/styles/tokens.test.ts`**

Reference data lives in this repo; the brand repo is never read. Structure follows `/home/pkuhn/gaproctrainer/apps/web/src/styles/tokens.test.ts` (block parser, `luminance`, `contrast`); copy its `bundle` record, replacing the `--color-accent` row with `['0f7c72', '01afa1']`.

```ts
describe('tokens.css matches docs/brand/BRAND.md', () => {
  it('defines every BRAND.md token with its light value in :root', ...);
  it('overrides in the dark block exactly the tokens whose dark value differs', ...);
  it('defines no --color-* token absent from BRAND.md', ...);
});
describe('tokens.css matches the re-typed brand bundle', () => { /* one it per bundle row and theme */ });
describe('the teal accent is derived at the brand azure lightness and chroma', () => {
  // oklch(hex) in the test
  const derived = [
    ['--color-accent-strong', 'light', '#21568c'], ['--color-accent-tint', 'light', '#eaf1f8'],
    ['--color-accent', 'dark', '#5e9be0'], ['--color-accent-strong', 'dark', '#82b2e8'],
    ['--color-accent-tint', 'dark', '#16222f'],
  ] as const;
  it.each(derived)('%s %s', (token, theme, azure) => {
    const [l, c, h] = oklch(value(token, theme));
    const [la, ca] = oklch(azure);
    expect(Math.abs(l - la)).toBeLessThanOrEqual(0.003);
    expect(c).toBeLessThanOrEqual(ca + 0.002);
    expect(Math.abs(h - 184.8)).toBeLessThanOrEqual(1.5);
  });
});
describe('WCAG AA contrast', () => {
  // both themes, each ≥ 4.5:
  // text, text-secondary, text-muted, success, warning, danger, accent on bg and on surface;
  // on-accent on accent; accent-strong on surface and on bg; on-accent on accent-strong;
  // text on accent-tint; accent-strong on accent-tint
});
describe('scene tokens', () => {
  it('defines --scene-<key> for every scene palette key, as 6-digit hex, in :root only', ...);
  it('keeps the scene accent at #0f7c72', ...);
});
```
Scene keys list in the test: `sky verge yard pavement street marking kerb wall fence hall ramp lamp parked cone cab body chassis wheel tracks accent`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/styles/tokens.test.ts`
Expected: FAIL (files missing).

- [ ] **Step 3: Write `tokens.css`, `docs/brand/BRAND.md`, `base.css`, `fonts.ts`**

- `tokens.css`: copy the `:root` and `[data-theme='dark']` blocks of `/home/pkuhn/gaproctrainer/apps/web/src/styles/tokens.css`, dropping every `--panel-*` token and the 3200px media block; set the accent family from the table above (adding `--color-accent-tint`); add the scene tokens to `:root`: sky `#dce0e4`, verge `#969ca4`, yard `#c2c7cd`, pavement `#e6e9ec`, street `#5e646b`, marking `#fbfbfc`, kerb `#eef0f2`, wall `#969ca4`, fence `#3b4046`, hall `#e6e9ec`, ramp `#5e646b`, lamp `#2a2e33`, parked `#3b4046`, cone `#eef0f2`, cab `#eef0f2`, body `#c2c7cd`, chassis `#1b1e22`, wheel `#14161a`, tracks `#3b4046`, accent `#0f7c72`.
- `docs/brand/BRAND.md`: origin (inherits the DocGerdSoft neutral core, mark, Geist, spacing, radii and status inks; one accent added), the derivation rule and the table above, the tint text rule, then one row per `--color-*` token in the form ``| `--name` | `#light` | `#dark` |``, which the test parses.
- `base.css`: `html, body` margin 0, `height: 100%`, `background: var(--color-bg)`, `color: var(--color-text)`, `font: var(--weight-regular) var(--text-md)/var(--leading-md) var(--font-sans)`, `overscroll-behavior: none`; `.mono` sets `font-family: var(--font-mono); font-feature-settings: 'tnum' 1, 'zero' 1, 'calt' 0, 'liga' 0`.
- `fonts.ts`: imports `@fontsource/geist/latin-{400,500,600}.css` and `@fontsource/geist-mono/latin-{400,500}.css`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/styles/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Mark, icons, font licence**

- `public/favicon.svg`: the brand mark paths (`M50 17.09 L69.87 51.5 L30.13 51.5 Z`, `M26.96 57 L73.04 57 L88 82.91 L12 82.91 Z`, viewBox `0 0 100 100`), fill `#0F7C72`, and `#01AFA1` under `@media (prefers-color-scheme: dark)`.
- `scripts/icons.mjs`: renders with Playwright's `chromium` (no new dependency). 192 and 512 px: mark `#01AFA1` at 62 % on a `#0D0E10` rounded square, radius 22 %. Maskable 512 px: full-bleed `#0D0E10` with the mark at 50 %. Writes the three PNGs to `public/`. The ESLint config gives `.mjs` no Node globals, so the script imports `process` from `node:process` and `fileURLToPath` from `node:url`; output paths come from `fileURLToPath(import.meta.resolve('../public/<name>'))`. It uses no `console` and no global `URL`; errors stay uncaught, so the exit code is non-zero.
- `public/licenses/geist-OFL.txt`: copy of `node_modules/@fontsource/geist/LICENSE`.

Run: `pnpm icons && file public/pwa-*.png`
Expected: three PNGs of 192×192, 512×512, 512×512.

- [ ] **Step 6: Deliver** — PR `feat: tokens, teal accent, fonts and mark` from `task/4-theming`.

---

### Task 5: i18n message files

**Depends on:** 1 · **Parallel with:** 2, 3, 4

**Files:**
- Create: `src/i18n/en.ts`, `src/i18n/de.ts`, `src/i18n/i18n.ts`

**Interfaces:**
- Produces (from `src/i18n/i18n.ts`): `type Lang = 'de' | 'en'`; `detectLanguage(preferred: readonly string[]): Lang` (first entry starting with `de` → `'de'`, else `'en'`); `setLanguage(lang: Lang): void` (also sets `document.documentElement.lang`); `language(): Lang`; `t(key: MessageKey): string`; `formatNumber(value: number, fractionDigits: number): string` (`Intl.NumberFormat` of the current language, fixed digits); `applyMessages(root: ParentNode): void` (sets `textContent` of every `[data-i18n]` element to `t(its key)`). From `en.ts`: `en` (`as const`) and `type MessageKey = keyof typeof en`. From `de.ts`: `de: Record<MessageKey, string>`.

- [ ] **Step 1: Write the two flat files with exactly these keys**

| key | en | de |
|---|---|---|
| appName | Gegenlenker | Gegenlenker |
| tagline | Maneuvering trainer for a truck with a drawbar trailer | Rangiertrainer für Lkw mit Drehschemelanhänger |
| freeYard | Free yard | Freies Gelände |
| layoutDepot | Depot | Betriebshof |
| layoutLogistics | Logistics yard | Logistikhof |
| exercises | Exercises | Übungen |
| exerciseStraightReverse | Straight reverse | Gerade rückwärts |
| exerciseReverseBay | Reverse into a bay | Rückwärts in eine Lücke |
| exerciseReverseCorner | Reverse around a corner | Rückwärts um die Ecke |
| exerciseDockRamp | Dock at a ramp | An die Rampe setzen |
| exerciseSlalom | Slalom forward and back | Slalom vor und zurück |
| truck | Truck | Lkw |
| trailer | Trailer | Anhänger |
| best | Best | Bestwert |
| noResult | No result yet | Noch kein Ergebnis |
| replayLastRun | Replay last run | Letzte Fahrt ansehen |
| estimateNote | Some dimensions are estimates. | Einige Maße sind geschätzt. |
| settings | Settings | Einstellungen |
| language | Language | Sprache |
| theme | Theme | Darstellung |
| themeSystem | System | System |
| themeLight | Light | Hell |
| themeDark | Dark | Dunkel |
| speed | Speed | Tempo |
| stop | Stop | Stopp |
| gear | Gear | Fahrstufe |
| steer | Steer | Lenken |
| brake | Brake | Bremse |
| keys | Keys | Tasten |
| couplingAngle | Coupling | Kupplung |
| turntableAngle | Turntable | Drehschemel |
| contacts | Contacts | Berührungen |
| jackknifes | Jackknife stops | Knickstopps |
| directionChanges | Direction changes | Richtungswechsel |
| time | Time | Zeit |
| blockedContact | Contact – drive the other way | Berührung – in Gegenrichtung fahren |
| blockedCoupling | Coupling limit – drive the other way | Kupplung am Anschlag – in Gegenrichtung fahren |
| blockedTurntable | Turntable limit – drive the other way | Drehschemel am Anschlag – in Gegenrichtung fahren |
| viewFollow | Follow | Folgen |
| viewYard | Whole yard | Ganzer Hof |
| aidPivots | Pivot angles | Knickwinkel |
| aidPath | Predicted path | Vorausschau |
| aidTracks | Wheel tracks | Radspuren |
| aidGhost | Target ghost | Zielbild |
| finish | Finish | Beenden |
| menu | Menu | Menü |
| result | Result | Ergebnis |
| targetReached | Target reached | Ziel erreicht |
| targetMissed | Target not reached | Ziel nicht erreicht |
| positionError | Position error | Positionsabweichung |
| angleError | Angle error | Winkelabweichung |
| newBest | New best | Neuer Bestwert |
| retry | Retry | Wiederholen |
| replay | Replay | Wiederholung |
| play | Play | Abspielen |
| pause | Pause | Pause |
| back | Back | Zurück |
| updateAvailable | Update available | Update verfügbar |
| reload | Reload | Neu laden |
| later | Later | Später |
| offlineReady | Ready offline | Offline bereit |
| noWebgl | This device cannot show WebGL 2 graphics. | Dieses Gerät kann keine WebGL-2-Grafik anzeigen. |
| contextLost | Graphics were reset. Reload to continue. | Die Grafik wurde zurückgesetzt. Zum Fortfahren neu laden. |
| langDe | Deutsch | Deutsch |
| langEn | English | English |
| keySpace | Space | Leertaste |

- [ ] **Step 2: Implement `src/i18n/i18n.ts`** with the signatures above; the current language is module state, defaulting to `'de'`.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0. A key missing from `de.ts`, or present only there, is a type error.

- [ ] **Step 4: Deliver** — PR `feat: German and English messages` from `task/5-i18n`.

---

### Task 6: Renderer spike: four views at 60 fps

**Depends on:** 2, 4 · **Parallel with:** 7–12

Proves the riskiest part first. Nothing else in presentation starts before this passes.

**Files:**
- Create: `src/render/coords.ts`, `src/render/viewports.ts`, `src/render/governor.ts`, `src/render/mirror.ts`, `src/render/three-renderer.ts`, `src/render/palette.ts`, `src/render/perf-overlay.ts`, `src/render/placeholder.ts`, `src/render/probe.ts`, `e2e/perf/four-views.perf.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 2 contracts and `truckAnchors` (`src/vehicles/anchors.ts`); `--scene-*` tokens (Task 4).
- Produces:
  - `src/render/coords.ts`: `toThree(x: number, y: number, up?: number): Vector3`; `placePose(object: Object3D, pose: Pose2): void`.
  - `src/render/viewports.ts`: `computeViewports(cssWidth: number, cssHeight: number, mode: ViewMode): ViewRects`.
  - `src/render/governor.ts`: `createResolutionGovernor(): { sample(frameMs: number): number; reset(): void; scale(): number }`.
  - `src/render/three-renderer.ts`: `createThreeSceneRenderer(parts: RendererParts): SceneRenderer`.
  - `src/render/palette.ts`: `readScenePalette(el?: Element): ScenePalette`.
  - `src/render/perf-overlay.ts`: `mountPerfOverlay(root: HTMLElement, stats: () => RenderStats): () => void`.
  - `src/render/placeholder.ts`: `placeholderParts: RendererParts`, `placeholderTruck: TruckSpec`, `placeholderTrailer: TrailerSpec`, `placeholderLayout: ResolvedLayout`.
  - `src/render/probe.ts`: `startProbe(root: HTMLElement): void`; sets `window.__probe = { stats: () => RenderStats }`.

- [ ] **Step 1: Viewports, coords, governor**

`computeViewports`:
- `replay`: `topDown` is the full canvas and the other views are `null`.
- Landscape (w ≥ h): `topDown = {0, 0, round(0.4w), h}`; `cockpit` is the remaining right part.
- Portrait: `topDown = {0, 0, w, h − round(0.55h)}`; `cockpit` is the bottom `round(0.55h)`. In both orientations the screen's bottom-right corner, where the wheel sits, is inside the cockpit view, so the steering wheel shows there. The lever sits bottom-left: inside the cockpit in portrait, over the top-down view's bottom-left corner in landscape.
- Mirrors inside the cockpit: `mw = clamp(round(0.15 · cockpit.width), 72, 200)`, `mh = min(2·mw, round(0.5 · cockpit.height))`, `y = cockpit.y + round(0.16 · cockpit.height)`. Left mirror `x = cockpit.x + 16`; right mirror `x = cockpit.x + cockpit.width − 16 − mw`.

Governor: keeps the last 60 frame intervals. When the window is full and the 90th percentile exceeds 18.5 ms, it sets `scale = max(0.5, scale − 0.15)` and clears the window. It never raises the scale; `reset()` returns to 1.

- [ ] **Step 2: `createThreeSceneRenderer`**

Setup:
- `WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })`, `autoClear = false`, `info.autoReset = false`.
- `init` rethrows when the `WebGLRenderer` constructor fails to create a context; it does not probe the canvas with `getContext` first, because that would fix the context attributes.
- Pixel ratio `min(devicePixelRatio, 2) × governor.scale()`. `resize` calls `setSize(w, h, false)` and `governor.reset()`.

Cameras:
- Anchors map from the truck body frame to the world through the snapshot's truck pose, every frame.
- Cockpit: perspective, vertical FOV 55°, pitch −6°, at `truckAnchors(truck).eye` and facing the truck heading.
- Mirrors: perspective, vertical FOV 30°, near 0.2, at `mirrorLeft` / `mirrorRight`, facing truck heading + π, yawed 7° outward, pitch −4°.
- Top-down: orthographic, north-up, layers 0 and `AIDS_LAYER`. `follow`: half-height 20 m, centred midway between the truck bumper and `trailerRear`. `yard`: fits the `yard` and `street` surfaces plus a 5 m margin.

Frame order:
1. Each mirror renders into its own `WebGLRenderTarget`, sized to the mirror rect × pixel ratio.
2. Clear the canvas (scissor test off) to `palette.sky`.
3. Render the cockpit and top-down views with scissor and viewport, converting y to bottom-left.
4. Draw each mirror's quad (uv u → 1 − u, `MeshBasicMaterial` mapping the target) through an orthographic camera into the mirror rect.

Stats and events:
- `stats()`: fps (EMA of render-call intervals), p95 of the last 120 intervals, scale, draw calls summed per frame, the `WEBGL_debug_renderer_info` unmasked renderer (or `'unknown'`), and `contextLost` (set on `webglcontextlost` with `preventDefault()`, cleared on `webglcontextrestored`).
- `render` is a no-op while the context is lost.

`setScene` disposes the previous parts and builds new ones from `parts`. Mirror cameras get no `AIDS_LAYER`.

- [ ] **Step 3: Placeholder content, palette, probe, overlay**

- `placeholderParts`:
  - Truck: a box with an asymmetric marker block on its left rear corner.
  - Trailer: two boxes following the snapshot's dolly and trailer poses.
  - Environment: ground plus about 300 seeded boxes merged into at most 8 meshes, with L-shaped blocks so mirroring is visible. Lighting is a `HemisphereLight` plus a `DirectionalLight` from the south-west at 50° elevation, on `MeshLambertMaterial`.
  - Aids: an empty group.
- `readScenePalette`: reads `--scene-<key>` through `getComputedStyle` and parses the hex to a number. It throws on a missing token.
- `startProbe`:
  - Imports `../styles/tokens.css`, `../styles/base.css` and `../styles/fonts`.
  - Mounts a full-window canvas with `createThreeSceneRenderer(placeholderParts)`.
  - Animates a synthetic `SimSnapshot` along a 15 m radius circle at 1.4 m/s with fixed pivot angles.
  - Shows `mountPerfOverlay` (mono, top-left: fps, p95, scale, draw calls, GL renderer).
- `src/main.ts`: `?probe` in the URL calls `startProbe(document.body)`.

- [ ] **Step 4: Write the perf check `e2e/perf/four-views.perf.ts`**

```ts
for (const orientation of ['landscape', 'portrait'] as const) {
  test(`four views hold 60 fps on a throttled tablet (${orientation})`, async ({ page, context }) => {
    // portrait: viewport 640×1024 (Galaxy Tab S9)
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('./?probe');
    // settle(): waits until resolutionScale is unchanged for 3 s (at most 40 s), so governor steps are over
    await settle(page);
    // sample(): reads window.__probe.stats() every 500 ms → median fps, worst p95, final scale, glRenderer
    const stats = await sample(page, 20_000);
    test.skip(/SwiftShader|llvmpipe|Software/i.test(stats.glRenderer), `no hardware GL (${stats.glRenderer}): result invalid`);
    expect(stats.medianFps).toBeGreaterThanOrEqual(58);
    expect(stats.frameP95Ms).toBeLessThanOrEqual(20);
    expect(stats.resolutionScale).toBeGreaterThanOrEqual(0.5);
    console.log(orientation, JSON.stringify(stats));
  });
}
```

- [ ] **Step 5: Run the perf check locally (headed Chrome, hardware GL; never in CI)**

Run: `pnpm test:perf`
Expected: both tests PASS with a hardware `glRenderer`. A skip means no hardware GL: run it on a machine with a GPU, or do the device check in Step 6. If fps fails only because of the mirror passes, switch to the fallback: render the mirrors directly into their rects with the projection x-scaled by −1 and every material's `side` swapped for that pass. Re-check the shading too, since `BackSide` changes the facing used for normals. If it still fails at scale 0.5, stop and report to the owner.

- [ ] **Step 6: Manual check of mirrors and shading**

Run `pnpm dev --host`, open `/?probe` in Chrome on the reference tablet and on the desktop.
Expected:
- The left mirror shows the trailer's left side along its inner (right) edge and the marker block on the truck's left rear corner. The right mirror shows the trailer's right side along its inner (left) edge.
- Placeholder blocks are solid, never see-through, and their sun-lit faces are the same physical faces as in the top-down view.
- The tablet overlay reads 58 fps or more.

- [ ] **Step 7: Deliver** — PR `feat: four-view renderer with mirrors and resolution fallback` from `task/6-renderer-spike`; paste the perf output lines into the PR body.

---

### Task 7: Vehicle data, validation, resolution

**Depends on:** 2 · **Parallel with:** 6, 8–12

**Files:**
- Create: `src/vehicles/sources.ts`, `src/vehicles/man-le-18-280.ts`, `src/vehicles/arocs-1835-ak.ts`, `src/vehicles/krone-azw-18.ts`, `src/vehicles/hueffermann-hpa-24-81-l.ts`, `src/vehicles/registry.ts`, `src/vehicles/resolve.ts`, `src/vehicles/validate.ts`
- Test: `src/vehicles/vehicles.test.ts`

**Interfaces:**
- Consumes: `TruckSpec`, `TrailerSpec`, `Param`, `VehicleParams`, `TRUCK_IDS`, `TRAILER_IDS` (`src/contracts/vehicle.ts`); `truckAnchors`, `trailerAnchors` (`src/vehicles/anchors.ts`).
- Produces:
  - `src/vehicles/sources.ts`: `SOURCES = { A, B, D, K, H }` (URLs from the spec), `sourced(value, src)`, `estimate(value, basis)`, both returning `Param`.
  - `src/vehicles/registry.ts`: `trucks: readonly TruckSpec[]`, `trailers: readonly TrailerSpec[]`, `truckById(id: TruckId): TruckSpec`, `trailerById(id: TrailerId): TrailerSpec`.
  - `src/vehicles/resolve.ts`: `maxRoadWheelAngle(truck: TruckSpec): number` (rad), `resolveCombination(truck: TruckSpec, trailer: TrailerSpec): VehicleParams`.
  - `src/vehicles/validate.ts`: `validateTruck(t: TruckSpec): string[]`, `validateTrailer(t: TrailerSpec): string[]`, `validatePair(t: TruckSpec, r: TrailerSpec): string[]` (each returns problems; empty means valid).

Data (mm, degrees; S = sourced [ref], E = estimate with basis):

| | MAN LE 18.280 (`platform`) | Arocs 1835 AK (`tipper`) |
|---|---|---|
| wheelbase | 3,900 E (fleet; 3,600/3,900/4,500 offered [D]) | 3,900 S [B] |
| frontOverhang | 1,320 E | 1,450 E |
| rearOverhang | 1,100 S [D] | 1,435 E |
| length | — | 6,785 S [B] |
| width | 2,490 S [D] | 2,500 S [A] |
| frontTrack / rearTrack | 1,950 / 1,800 E | 2,050 / 1,850 E |
| couplingOffset | 1,250 E | 1,500 E |
| turningRadius | 7,800 S [D] (at 3,900) | 8,150 S [A] (16.3 m kerb circle halved) |
| eye height / behindBumper / leftOfCentre | 1,950 / 1,000 / 400 E | 2,150 / 1,300 / 500 E |
| mirror lateral / glassOutboard / behindBumper / height | 1,250 / 200 / 600 / 2,000 E | 1,400 / 200 / 700 / 2,200 E |
| steering lockToLockTurns / maxRate | 5.0 / 1.5 E | 5.0 / 1.5 E |

| | Krone AZW 18 (`box`) | Hüffermann HPA 24.81 L (`low-loader`) |
|---|---|---|
| drawbar | 2,200 S [K] | 2,600 E |
| wheelbase | 5,170 S [K] | 5,600 E (to tandem centre) |
| rearAxleCount / rearAxleSpacing | 1 S [K] / — | 2 E / 1,310 E |
| frontOverhang | 600 E (fits a 7.45 m swap body) | 900 E |
| rearOverhang | 1,675 E (length to eye − drawbar − wheelbase) | 2,220 E (sourced length − drawbar − wheelbase) |
| lengthToEye | 9,045 S [K] | 10,420 S [H] |
| width | 2,550 E | 2,550 S [H] |
| track | 2,040 E | 2,040 E |
| deckHeight | 1,280 E (midpoint of 1,190–1,370 [K]) | 700 E |
| couplingLimit / turntableLimit | 80 / 85 E (mechanical stop near 90°: drawbar meets frame or truck rear corner) | 80 / 85 E (same) |

- [ ] **Step 1: Write the failing tests `src/vehicles/vehicles.test.ts`**

```ts
it('gives every parameter a finite value and a source', () => {
  // sourced → source matches /^https:\/\//; estimate → source.trim() !== ''
});
it('keeps sourced lengths consistent', () => {
  // arocs: frontOverhang + wheelbase + rearOverhang === length (6785)
  // each trailer: drawbar + wheelbase + rearOverhang === lengthToEye (9045, 10420)
});
it('declares rear axle spacing exactly for multi-axle groups', ...); // rearAxleCount ∈ {1,2}; spacing iff count > 1
it('places the eye inside the cab and the mirrors outside the body', () => {
  // 0 < eye.leftOfCentre < width/2; eye.behindBumper < frontOverhang + wheelbase; mirror.lateral ≥ width/2
});
it('keeps pivot limits between 0 and 90 degrees', ...);
it('leaves clearance between truck rear and trailer front for every pair', () => {
  // couplingOffset + drawbar − trailer.frontOverhang − truck.rearOverhang ≥ 500 for all 4 pairs
});
it('calibrates full lock from the turning radius', () => {
  expect(deg(maxRoadWheelAngle(man))).toBeCloseTo(34.01, 1);
  expect(deg(maxRoadWheelAngle(arocs))).toBeCloseTo(32.46, 1);
});
it('resolves a combination to metres and radians', () => {
  const p = resolveCombination(man, krone);
  expect(p).toMatchObject({ wheelbase: 3.9, couplingOffset: 1.25, drawbar: 2.2, trailerWheelbase: 5.17,
    truckFront: 5.22, truckRear: 1.1, trailerFrontOverhang: 0.6, trailerRearOverhang: 1.675, steerRate: 0.6 });
  expect(p.couplingLimit).toBeCloseTo((80 * Math.PI) / 180, 12);
  expect(p.turntableLimit).toBeCloseTo((85 * Math.PI) / 180, 12);
});
it('derives anchors from the data', () => {
  expect(truckAnchors(man).eye).toEqual({ x: 4.22, y: 0.4, z: 1.95 });          // toBeCloseTo per field
  expect(truckAnchors(man).mirrorRight).toEqual({ x: 4.62, y: -1.45, z: 2.0 });
  expect(truckAnchors(arocs).mirrorLeft).toEqual({ x: 4.65, y: 1.6, z: 2.2 });
  expect(trailerAnchors(hueffermann).rearAxles.map((a) => a.x)).toEqual([0.655, -0.655]);
});
it('validates the registry', () => {
  for (const t of trucks) expect(validateTruck(t)).toEqual([]);
  for (const r of trailers) expect(validateTrailer(r)).toEqual([]);
  for (const t of trucks) for (const r of trailers) expect(validatePair(t, r)).toEqual([]);
  expect(trucks.map((t) => t.id)).toEqual([...TRUCK_IDS]);
  expect(trailers.map((r) => r.id)).toEqual([...TRAILER_IDS]);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run src/vehicles`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the data files, registry, resolve and validate**

`maxRoadWheelAngle`: `Rr = sqrt(R² − L²) − Tf/2`, `δmax = atan(L / Rr)`, with R = turningRadius, L = wheelbase and Tf = frontTrack (all m). It treats the turning radius as the outer front wheel centre's path, an assumption the README states. `steerRate = 2 · maxRate / lockToLockTurns`. `validateTruck` / `validateTrailer` return one message per broken single-vehicle rule from the tests above; `validatePair` checks the clearance rule.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/vehicles`
Expected: PASS.

- [ ] **Step 5: Deliver** — PR `feat: vehicle data with sourced and estimated parameters` from `task/7-vehicles`.

---

### Task 8: Collision

**Depends on:** 2 · **Parallel with:** 6, 7, 9–12

**Files:**
- Create: `src/sim/collision.ts`
- Test: `src/sim/collision.test.ts`

**Interfaces:**
- Consumes: `Obb`, `BodyFootprint`, `ContactQuery`, `SimContact` (`src/contracts/sim.ts`); `Obstacle` (`src/contracts/layout.ts`).
- Produces: `obbOverlap(a: Obb, b: Obb): boolean`; `createContactQuery(obstacles: readonly Obstacle[]): ContactQuery`; `OVERLAP_EPSILON = 1e-6`.

- [ ] **Step 1: Write the failing tests**

```ts
it('separated boxes do not overlap', ...);
it('overlapping boxes overlap', ...);
it('touching is not a contact', () => {
  // trailer rear face flush with a ramp face: gap 0 and gap 1e-7 → false; penetration 1e-4 → true
});
it('uses the oriented boxes, not their bounds', () => {
  // two unit boxes rotated 45°, corners 0.05 apart where their AABBs intersect → false
});
it('a box inside another overlaps', ...);
it('finds the first obstacle in body then obstacle order', () => {
  // bodies [truck, drawbar, trailer]; trailer hits obstacle 'b', truck hits 'c' → { body: 'truck', obstacleId: 'c' }
});
it('reports truck against trailer body as self', () => {
  expect(query([truck, drawbar, trailerOverlappingTruck])).toEqual({ body: 'trailer', obstacleId: 'self' });
});
it('ignores the jointed pairs truck–drawbar and drawbar–trailer', ...);
it('returns null when clear', ...);
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run src/sim/collision.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

SAT on the four box axes. Overlap only when every axis's projection overlap is greater than `OVERLAP_EPSILON`. The query rejects by bounding circle (`hypot(halfLength, halfWidth)`) before SAT. Its order: for each body in input order, for each obstacle in array order; then the truck–trailer pair.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim/collision.test.ts`
Expected: PASS.

- [ ] **Step 5: Deliver** — PR `feat: oriented-box collision` from `task/8-collision`.

---

### Task 9: Scoring and best results

**Depends on:** 2 · **Parallel with:** 6–8, 10–12

**Files:**
- Create: `src/scoring/score.ts`, `src/scoring/best.ts`
- Test: `src/scoring/scoring.test.ts`

**Interfaces:**
- Consumes: `SimSnapshot`, `Vec2` (`src/contracts/sim.ts`); `ExerciseDefinition`, `TargetZone`, `RunResult`, `BestResults`, `EXERCISE_IDS` (`src/contracts/exercise.ts`); `TruckId`, `TrailerId`, `TRUCK_IDS`, `TRAILER_IDS`; `wrapAngle` (`src/sim/angle.ts`).
- Produces:
  - `src/scoring/score.ts`: `WAYPOINT_RADIUS = 3`; `targetError(s: SimSnapshot, zone: TargetZone): { position: number; angle: number }` (m and degrees); `createRunTracker(exercise: ExerciseDefinition): { update(s: SimSnapshot): boolean }` (true once reached); `runResult(s: SimSnapshot, exercise: ExerciseDefinition, truckId: TruckId, trailerId: TrailerId): RunResult`.
  - `src/scoring/best.ts`: `bestKey(exerciseId, truckId, trailerId): string` (`${exerciseId}/${truckId}/${trailerId}`); `compareResults(a: RunResult, b: RunResult): number` (< 0 when a is better); `recordBest(best: BestResults, r: RunResult): { best: BestResults; isNewBest: boolean }`; `serializeBestResults(best: BestResults): string`; `parseBestResults(raw: string | null): BestResults`.

- [ ] **Step 1: Write the failing tests**

```ts
it('measures position at the trailer rear and angle at the trailer heading', () => {
  // trailerRear (3,4) vs zone (0,0) → 5; trailer heading 0.1 rad vs zone −0.1 → 11.459°; wraps across ±π
});
it('reaches the target only when stopped within tolerance', () => {
  // within tolerance with speed 0.2 → false; same with speed 0 → true; position 0.51 > 0.5 → false
});
it('requires the waypoint before the target counts', () => {
  // exercise with waypoint (90,25): stopped in target before visiting → false; after truck within 3 m of it → true
});
it('fills a result from the final snapshot', () => {
  // copies contacts, jackknifes, directionChanges, time; reached flag; errors from targetError
});
it('orders results: reached, then fewer events, then fewer direction changes, then less time', ...);
it('keeps only better results', () => {
  // worse result → same object, isNewBest false; better → replaced, isNewBest true; first → stored, true
});
it('reads stored results defensively', () => {
  expect(parseBestResults(null)).toEqual({});
  expect(parseBestResults('{')).toEqual({});
  expect(parseBestResults(JSON.stringify({ version: 2, results: {} }))).toEqual({});
  // a valid entry survives a round trip through serializeBestResults; an entry missing `time` or with a
  // key not matching its fields is dropped while valid siblings stay
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run src/scoring`
Expected: FAIL.

- [ ] **Step 3: Implement**

Storage format: `{ version: 1, results: BestResults }`. "Events" in the ordering means `contacts + jackknifes`. The tracker latches `waypointVisited` when the distance from `s.truck` to the waypoint is at most `WAYPOINT_RADIUS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/scoring`
Expected: PASS.

- [ ] **Step 5: Deliver** — PR `feat: scoring and best results` from `task/9-scoring`.

---

### Task 10: Yards, street, exercises

**Depends on:** 2 · **Parallel with:** 6–9, 11, 12

**Files:**
- Create: `src/content/street.ts`, `src/content/resolve-layout.ts`, `src/content/layouts/depot.ts`, `src/content/layouts/logistics.ts`, `src/content/exercises/straight-reverse.ts`, `src/content/exercises/reverse-bay.ts`, `src/content/exercises/reverse-corner.ts`, `src/content/exercises/dock-ramp.ts`, `src/content/exercises/slalom.ts`, `src/content/registry.ts`

**Interfaces:**
- Consumes: `Layout`, `StreetSpec`, `ResolvedLayout`, `Obstacle`, `Marking`, `Surface` (`src/contracts/layout.ts`); `ExerciseDefinition` (`src/contracts/exercise.ts`).
- Produces:
  - `src/content/street.ts`: `streetFeatures(street: StreetSpec): { surfaces: Surface[]; obstacles: Obstacle[]; markings: Marking[] }`.
  - `src/content/resolve-layout.ts`: `resolveLayout(layout: Layout, exercise: ExerciseDefinition | null): ResolvedLayout` (yard surface + street features + layout obstacles and markings + exercise obstacles and markings; `target` from the exercise).
  - `src/content/registry.ts`: `layouts: Readonly<Record<LayoutId, Layout>>` (exactly `LAYOUT_IDS`), `exercises: readonly ExerciseDefinition[]` (exactly `EXERCISE_IDS`, in that order), `exerciseById(id: ExerciseId): ExerciseDefinition`.

Street (both layouts): `kerbY −2.5`, `width 7.0`, `pavement 2.5`, `fromX/toX` = bounds, entrance x ∈ [42, 58]. `streetFeatures` emits:
- Surfaces: the street and both pavements.
- Kerbs: 0.15 m wide, 0.15 m high, on both street edges. The yard-side kerb is split at the entrance.
- Markings: a dashed centre line (0.12 m) and solid edge lines 0.3 m inside each kerb.

Obstacle ids, unique per resolved layout: `street-<kind>-<n>` from `streetFeatures`, `<kind>-<n>` from a layout, `ex-<kind>-<n>` from an exercise.

Common frame: yard `[0,100] × [0,70]`, bounds `[−40,140] × [−40,100]`. The yard edge runs around the yard perimeter, with a gap at y = 0, x ∈ [42, 58].

| Layout | Yard edge | Landmarks | Free-drive `start` |
|---|---|---|---|
| depot | fence 0.1 × 2.0 m | hall `[60,96] × [42,64]`, 8 m high, built from wall boxes with two 4.5 m gates on its south side; three parked-vehicle blocks 2.5 × 10 × 3.5 m along the west fence within y ∈ [36, 66]; lamp posts 0.3 × 0.3 × 6 m in the yard corners and every 25 m on the far pavement | truck rear axle (30, 15), heading 0 |
| logistics | wall 0.3 × 2.5 m | hall `[10,74] × [52,68]`; ramp block `[14,70] × [49,52]`, 1.2 m high (face at y = 49), with bay lines every 4 m reaching 18 m into the yard; four parked trailers 2.5 × 13.6 × 4 m on the east side; lamp posts as in depot | truck rear axle (30, 20), heading 0 |

| Exercise | Layout | Setup | Target | Tolerances | Waypoint |
|---|---|---|---|---|---|
| straight-reverse | depot | cone corridor, 3.6 m clear, x ∈ [8, 48] at y = 30, cones (0.4 × 0.4 × 0.8 m) every 5 m; start truck rear axle (70, 30), heading 0 | trailer rear (10, 30), heading 0 | 0.5 m, 3° | — |
| reverse-bay | logistics | bay 4.0 m wide and 16 m deep between two parked blocks, closed by a wall; start perpendicular to the bay, so the maneuver is a 90° reverse | trailer rear 1.0 m off the wall, pointing out of the bay | 0.5 m, 4° | — |
| reverse-corner | depot | lane 9 m wide bounded by kerbs, with a 90° corner to the driver's (left) side and a 6 m corner kerb radius | trailer rear 15 m into the second leg, along it | 0.7 m, 5° | — |
| dock-ramp | logistics | one 4 m bay between two bay lines at the ramp | trailer rear 0.15 m off the ramp face, square to it | 0.3 m, 2° | — |
| slalom | depot | lane y ∈ [14, 26] bounded by kerbs from x = 2 to 98; four barriers at x = 28, 48, 68, 88 (each seven cones spanning 6.4 m, reaching past the lane centre so the course forces a weave) from alternating sides, south first; start truck rear axle (16, 20), heading 0 | trailer rear (2.5, 20), heading 0 | 1.0 m, 6° | (92, 20) |

Layout constraints (Task 18 tests the first three; the implementer checks the rest by construction):
- The combination starts straight and is clear for all four pairs (the longest, Arocs + Hüffermann, is 17.27 m from bumper to trailer rear).
- It can move 0.5 m both ways from the start without an event.
- No start is already within tolerance of its target.
- The target zone is inside the yard and overlaps no obstacle.
- Slalom fit:
  - The longest trailer rear starts at x = 4.08 (1.58 m from the target; MAN + Krone at 5.71), and the target leaves 2.4 m to the fence.
  - The truck front starts at 21.35, before the first barrier at 28.
  - At the waypoint (rear axle x ≥ 89) the truck front is at least 94.35, short of the fence at 100.
  - Each barrier leaves an 8.5 m passage.

- [ ] **Step 1: Implement `streetFeatures`, `resolveLayout`, the two layouts, the five exercises and the registry** to the tables above.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0. Task 18 is this content's test gate.

- [ ] **Step 3: Deliver** — PR `feat: yards with street and five exercises` from `task/10-content`.

---

### Task 11: PWA and update prompt

**Depends on:** 1, 4, 5 · **Parallel with:** 6–10, 12

**Files:**
- Create: `src/pwa/config.ts`, `src/pwa/update-prompt.ts`, `src/pwa/update-prompt.css`
- Modify: `vite.config.ts`, `src/vite-env.d.ts`

**Interfaces:**
- Consumes: `src/styles/tokens.css` (Task 4); `t` (`src/i18n/i18n.ts`) with keys `updateAvailable`, `reload`, `later`, `offlineReady`.
- Produces: `src/pwa/config.ts`: `tokenColor(css: string, name: string, theme: 'light' | 'dark'): string`, `pwaOptions(base: string, colors: { themeColor: string; backgroundColor: string }): Partial<VitePWAOptions>`. `src/pwa/update-prompt.ts`: `startUpdatePrompt(root: HTMLElement): void`.

- [ ] **Step 1: Implement**

`pwaOptions`:
- Registration: `registerType: 'prompt'`, `injectRegister: false`, `includeManifestIcons: false`.
- Manifest: `id`, `start_url` and `scope` = base; `name` and `short_name` `'Gegenlenker'`, `lang: 'de'`, `display: 'standalone'`, colours, the three icons from Task 4 (maskable marked `purpose: 'maskable'`).
- Workbox: `globPatterns: ['**/*.{html,js,css,svg,png,woff2,webmanifest}']`, `navigateFallback: 'index.html'`, `cleanupOutdatedCaches: true`, `clientsClaim: true`, `skipWaiting: false`.

`vite.config.ts`:
- Reads `src/styles/tokens.css`.
- Adds `VitePWA(pwaOptions(base, { themeColor: tokenColor(tokens, '--color-surface', 'light'), backgroundColor: tokenColor(tokens, '--color-bg', 'light') }))`.
- Adds a `transformIndexHtml` plugin emitting `<meta name="theme-color">` per scheme with `media="(prefers-color-scheme: …)"` (pattern: `/home/pkuhn/gaproctrainer/apps/web/vite.config.ts`).

`startUpdatePrompt`:
- Uses `registerSW` from `virtual:pwa-register`.
- `onNeedRefresh` shows a toast at the bottom edge (`updateAvailable`, buttons `reload` → `updateSW()` and `later` → hide).
- `onOfflineReady` shows `offlineReady` for 4 s.
- It never reloads on its own.

`src/vite-env.d.ts` adds `/// <reference types="vite-plugin-pwa/client" />`.

- [ ] **Step 2: Verify the build output**

Run: `BASE_PATH=/gegenlenker/ pnpm build && grep -q '"scope":"/gegenlenker/"' dist/manifest.webmanifest && grep -q 'woff2' dist/sw.js && grep -q 'name="theme-color"' dist/index.html`
Expected: exit 0.

- [ ] **Step 3: Deliver** — PR `feat: PWA precache and update prompt` from `task/11-pwa`.

---

### Task 12: Input mapping and controls

**Depends on:** 2, 4, 5 · **Parallel with:** 6–11

**Files:**
- Create: `src/input/mapping.ts`, `src/input/keyboard.ts`, `src/input/controls.ts`, `src/input/controls.css`, `dev/controls.html`, `dev/controls.ts`

**Interfaces:**
- Consumes: `ControlVector`, `Gear` (`src/contracts/sim.ts`); `t` with keys `stop`, `speed`, `gear`, `steer`.
- Produces: `src/input/controls.ts`: `createControls(root: HTMLElement, opts: { lockToLockTurns: number; steerRate: number }): Controls` with `Controls = { control(): ControlVector; tick(dt: number): void; dispose(): void }`. `src/input/mapping.ts`: `type InputState = { steer: number; lever: number; brake: boolean; gear: Gear }` (one mutable state that every device writes), `toControlVector(s: InputState): ControlVector`, `LEVER_STEP = 0.1`.

One mapping layer, so every device writes the same `InputState`:

| Device | Steering | Speed lever (latching 0…1) | Brake | Gear |
|---|---|---|---|---|
| Touch | drag the wheel (screen bottom-right, inside the cockpit view) | drag or tap the lever track (bottom-left) | hold Stop (above the lever) | tap P / R / N / D (left of the wheel) |
| Keyboard | A / D or ← / → held: steer moves at `steerRate` per s (`tick`) | W / ↑ +0.1, S / ↓ −0.1 per keydown | Space held | 1 = P, 2 = R, 3 = N, 4 = D |
| Mouse | drag the wheel | scroll over the lever (±0.1) or click the track | press Stop | click the selector |

Rules:
- Wheel drag: accumulate the unwrapped `atan2` deltas around the wheel centre, ignoring pointers within 8 px of it. Clockwise steers right: `steer −= Δangle / (π · lockToLockTurns)`, clamped to [−1, 1]. The SVG wheel (generic, three spokes) rotates by `steer · lockToLockTurns · 180°`.
- Brake down sets `lever = 0` and `brake = true`; release sets `brake = false`. The lever stays at 0 until the driver sets it again.
- The steering wheel and the lever keep their positions: no self-centring.
- Each control captures its own `pointerId` (`setPointerCapture`), so two thumbs work at once. `touch-action: none` and `user-select: none` on the controls; `contextmenu` is prevented on them.
- Keys are ignored when the event target is an `input`, `select` or `textarea`, or Ctrl / Meta / Alt is held. Handled keys call `preventDefault()`. On `blur` or `visibilitychange` to hidden, held steer keys and the brake release.

- [ ] **Step 1: Implement mapping, keyboard, controls, CSS** to the table and rules. The CSS uses tokens only; controls are at least `--size-target`; the selected gear is filled with `--color-accent` and labelled in `--color-on-accent`.

- [ ] **Step 2: Dev harness**

`dev/controls.html` + `dev/controls.ts` mount the controls full-screen with `lockToLockTurns: 5`, `steerRate: 0.6`, and print `JSON.stringify(control())` in mono every frame.

- [ ] **Step 3: Manual verification**

Run `pnpm dev --host` and open `/dev/controls.html`.
Expected:
- Keyboard: each table row changes the printed vector as specified. Holding A, then switching windows and back, stops the steer drift.
- Mouse: dragging, scrolling and clicking match the table.
- On the reference tablet: steer and move the lever at the same time with two thumbs; neither drops. No page scroll, zoom, pull-to-refresh or context menu on a long press.

- [ ] **Step 4: Deliver** — PR `feat: touch, keyboard and mouse controls` from `task/12-input`.

---

### Task 13: Simulation core

**Depends on:** 2, 7 · **Parallel with:** 8–12, 14–17

**Files:**
- Create: `src/sim/constants.ts`, `src/sim/kinematics.ts`, `src/sim/geometry.ts`, `src/sim/simulation.ts`, `src/sim/clock.ts`, `src/sim/predict.ts`, `src/sim/replay.ts`
- Test: `src/sim/simulation.test.ts`, `src/sim/replay.test.ts`

**Interfaces:**
- Consumes: Task 2 sim, vehicle and exercise contracts, including `TRUCK_IDS`, `TRAILER_IDS`, `LAYOUT_IDS`, `EXERCISE_IDS`; `wrapAngle` (`src/sim/angle.ts`); `resolveCombination`, `trucks`, `trailers`, `truckById`, `trailerById` (`src/vehicles/*`). Tests stub `ContactQuery`; the real query (Task 8) is wired in Tasks 18 and 19.
- Produces:
  - `src/sim/constants.ts`: `DT = 1 / 60`, `V_MAX = 5 / 3.6`, `ACCEL = 0.5`, `DECEL = 0.8`, `BRAKE_DECEL = 2.5`, `DRAWBAR_WIDTH = 0.6`, `MAX_STEPS_PER_FRAME = 8`, `PREDICT_STEP = 0.5`.
  - `src/sim/simulation.ts`: `createSimulation(params: VehicleParams, start: StartState, contacts: ContactQuery): Simulation`.
  - `src/sim/geometry.ts`: `bodyFootprints(params: VehicleParams, s: SimSnapshot): BodyFootprint[]` (order: truck, drawbar, trailer).
  - `src/sim/clock.ts`: `advanceClock(accumulator: number, frameSeconds: number): { steps: number; accumulator: number }`.
  - `src/sim/predict.ts`: `predictTrailerRear(params: VehicleParams, from: SimSnapshot, direction: 1 | -1, distance: number): Vec2[]`.
  - `src/sim/replay.ts`: `createInputRecorder(): { record(step: number, control: ControlVector): void; finish(meta: Pick<InputLog, 'layoutId' | 'exerciseId' | 'truckId' | 'trailerId'>, steps: number): InputLog }`; `replaySnapshots(log: InputLog, sim: Simulation): SimSnapshot[]`; `parseInputLog(raw: string | null): InputLog | null`. The `step` passed to `record` is `sim.snapshot().step` before `sim.step(control)` runs, so the first is 0. Replay applies, at step i, the last change whose `step` ≤ i. `finish`'s `steps` is the final `snapshot().step`.

#### Kinematic model

State `q = (x₀, y₀, θ₀, θ₁, θ₂)`: truck rear-axle centre and truck heading, dolly heading, trailer heading. Inputs held over a step: signed speed `v` at the truck rear axle and road-wheel angle `δ`. Parameters: `L₀` wheelbase, `c` coupling offset (behind the rear axle), `d` drawbar (eye to turntable centre), `L₂` trailer wheelbase (turntable to effective rear axle). A tandem is one effective axle at its centre, so `L₂` runs to the tandem centre.

```
u(θ) = (cos θ, sin θ)
ẋ₀ = v cos θ₀        ẏ₀ = v sin θ₀        ω₀ = θ̇₀ = v tan δ / L₀
φ₁ = θ₀ − θ₁         θ̇₁ = (v sin φ₁ − c ω₀ cos φ₁) / d
v₁ = v cos φ₁ + c ω₀ sin φ₁                (speed of the turntable centre along u(θ₁))
φ₂ = θ₁ − θ₂         θ̇₂ = v₁ sin φ₂ / L₂
```

These follow from the no-slip constraints at the dolly axle and the trailer axle. The off-axle hitch (`c ≠ 0`) is the `c ω₀` terms. Integrate with classical RK4 over `DT`, with `v` and `δ` constant in the step. Positions are derived, never integrated, so the joints hold by construction:

```
P₀ = (x₀, y₀)      H = P₀ − c u(θ₀)      P₁ = H − d u(θ₁)      P₂ = P₁ − L₂ u(θ₂)
trailerRear = P₂ − trailerRearOverhang u(θ₂)
```

Footprints (`Obb`):
- Truck: from `P₀ + truckFront u(θ₀)` to `P₀ − truckRear u(θ₀)`, width `truckWidth`.
- Drawbar: from `H` to `P₁`, width `DRAWBAR_WIDTH`.
- Trailer: from `P₁ + trailerFrontOverhang u(θ₂)` to `P₂ − trailerRearOverhang u(θ₂)`, width `trailerWidth`.

Speed:
- Target `vt` is 0 when braking or in P/N; otherwise `±lever · V_MAX` (D → +, R → −).
- Rate: `BRAKE_DECEL` when braking or in P; `ACCEL` when |vt| > |v| and v is 0 or has the sign of vt; otherwise `DECEL`.
- `v` approaches `vt` by at most rate · DT.

Steering: `steer` approaches `control.steer` by at most `steerRate · DT`; `δ = steer · maxRoadWheelAngle`. Both are clamped to their ranges.

#### Step algorithm (`step(control)`)

1. Clamp `control.steer` to [−1, 1] and `control.lever` to [0, 1]; update `steer`, `δ`, `v`.
2. If `v === 0`: no motion; go to 6.
3. Candidate `q′ = rk4(q)`. Reject when `|wrap(θ₀′ − θ₁′)| > couplingLimit` (reason `coupling`), else `|wrap(θ₁′ − θ₂′)| > turntableLimit` (`turntable`), else `contacts(bodyFootprints(q′)) !== null` (`contact`).
4. On rejection: keep `q`, set `v = 0`. If the reason differs from `blocked`, add 1 to `jackknifes` (coupling or turntable) or `contacts`. Then set `blocked = reason`.
5. On acceptance: `q = q′`, `blocked = null`. If `sign(v)` differs from the last non-zero motion sign and that sign exists, add 1 to `directionChanges`; remember `sign(v)`.
6. `step += 1`, `time = step · DT`; return the snapshot.

Consequences, all tested:
- The accepted state is always valid, and a valid candidate is accepted whatever the direction, so driving the other way always recovers.
- On rejection, steering, the speed controller, the clock and the caller's input log still advance.
- One event is counted per blocked episode, not per tick.
- The lever is input state and stays where the driver set it.

Clock: `acc += min(frameSeconds, MAX_STEPS_PER_FRAME · DT)`; `steps = floor(acc / DT + 1e-9)`; `acc −= steps · DT`.

Prediction:
- Integrates the same equations from `from` with `from.roadWheelAngle` held, moving `direction · distance` in `PREDICT_STEP` arc-length steps of the truck rear axle.
- Returns `trailerRear` per step, starting with the current one.
- Stops before the first step that would exceed a pivot limit.

Recorder:
- Stores a change only when the control differs from the last stored one.
- `replaySnapshots` feeds `log.steps` steps.
- `parseInputLog` returns `null` for anything that is not a version-1 log whose ids are members of `TRUCK_IDS`, `TRAILER_IDS`, `LAYOUT_IDS` and `EXERCISE_IDS` (or `null` for `exerciseId`), with non-negative integer `steps` and ascending change steps.

- [ ] **Step 1: Write the failing tests `src/sim/simulation.test.ts`**

Helpers in the test:
- `drive(sim, control, steps)` runs `steps` steps and returns the snapshots.
- `open(p)` returns `{ ...p, couplingLimit: 3.1, turntableLimit: 3.1 }`, for the tests about geometry, not limits.
- `noContacts = () => null`.

```ts
it('full lock reproduces each truck’s sourced turning radius', () => {
  for (const truck of trucks) {
    const p = resolveCombination(truck, trailerById('krone-azw-18'));
    // settle steer = 1 at standstill (gear D, lever 0), then gear D lever 1 for 1.2 laps
    // outer (right) front wheel centre = P₀ + L₀ u(θ₀) − (frontTrack/2) n(θ₀); radius = max pairwise distance / 2
    expect(Math.abs(radius - truck.turningRadius.value / 1000)).toBeLessThan(0.02);
  }
});
it('a sustained full-lock forward circle raises no jackknife event', () => {
  // every pair, steer ramped from 0, gear D, lever 1, 300 m: jackknifes 0, blocked null.
  // MAN + Hüffermann at steer 0.9: at full lock its dolly-axle circle (5.31 m) is smaller than the trailer
  // wheelbase (5.60 m), so there is no steady state and the turntable passes 85°; at 0.9 it settles near 65°.
});
it('coupling and turntable constraints hold forward and reverse', () => {
  // every pair, opened limits, steer = 0.6·sin(0.8 t), 15 m forward then 15 m reverse
  // each step: |H − P₁| = drawbar ± 1e-9, |P₁ − P₂| = trailerWheelbase ± 1e-9,
  // H = truck − couplingOffset·u(θ₀) ± 1e-9,
  // lateral slip at P₁ and P₂ (finite difference projected on the mid-step normal) < 1e-3 m/s
});
it('straight reversing with a small disturbance diverges', () => {
  // MAN + Krone, turntableAngle 0.5°, steer 0, gear R, lever 1, 10 m → |turntableAngle| > 2.5°
});
it('straight forward driving damps the same disturbance', () => {
  // couplingAngle 2°, gear D, 30 m → |couplingAngle| < 0.2° and |turntableAngle| < 0.2°
});
it('exceeding a pivot limit rejects the step, stops and counts one event', () => {
  // reverse at full left lock until blocked: blocked ∈ {'coupling','turntable'}, jackknifes 1, speed 0,
  // |angle| ≤ its limit
});
it('pushing on while blocked keeps the vehicle still and counts one event', () => {
  // keep the same control 120 more steps: truck pose unchanged, jackknifes still 1;
  // then gear D: truck moves, blocked null, jackknifes 1
});
it('a contact rejects the step, stops and counts one event', () => {
  // MAN + Krone from the origin; stub query: contact 'wall' when the trailer obb centre x < −8; reverse straight →
  // blocked 'contact', contacts 1, speed 0; 60 more steps → contacts 1; gear D → moves, blocked null
});
it('D to R while moving decelerates through zero and counts one direction change', () => {
  // reach V_MAX in D, switch to R: speed decreases monotonically to −V_MAX,
  // never changes by more than ACCEL·DT + DECEL·DT per step, directionChanges === 1
});
it('steering is rate-limited and road-wheel angle follows the lock', () => {
  // target 1 from 0: after one step steer = steerRate·DT; reaches 1 after ceil(1/(steerRate·DT)) steps;
  // roadWheelAngle === steer · maxRoadWheelAngle
});
it('speed follows the latched lever and never exceeds the walking-pace cap', ...); // brake → 0 at BRAKE_DECEL
it('clamps long frame gaps', () => {
  expect(advanceClock(0, 5)).toEqual({ steps: MAX_STEPS_PER_FRAME, accumulator: expect.closeTo(0, 9) });
  expect(advanceClock(0, DT / 2).steps).toBe(0);
  expect(advanceClock(DT / 2, DT / 2).steps).toBe(1);
});
it('predicted trailer path matches the driven path', () => {
  // opened limits, constant steer 0.4, in D and in R: prediction over 10 m vs the trailerRear the sim
  // reaches after the same truck arc length, each within 0.02 m
});
```

`src/sim/replay.test.ts`:

```ts
it('a run replays identically from its input log', () => {
  // scripted 1,800 steps with steer, lever, gear and brake changes; record; replaySnapshots on a fresh
  // createSimulation with the same params/start/contacts → toEqual the live snapshots
});
it('stores only control changes', ...);
it('rejects malformed logs', () => {
  expect(parseInputLog(null)).toBeNull();
  expect(parseInputLog('[]')).toBeNull();
  // version 2, unknown truckId, negative steps, descending change steps → null; a valid log round-trips
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run src/sim/simulation.test.ts src/sim/replay.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the files to the model and algorithm above. No `Math.random`, `Date` or `performance` in `src/sim`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim`
Expected: PASS.

- [ ] **Step 5: Deliver** — PR `feat: kinematic simulation core with rejected steps and replay` from `task/13-sim`.

---

### Task 14: Procedural vehicle visuals

**Depends on:** 6, 7 · **Parallel with:** 13, 15–18

**Files:**
- Create: `src/render/vehicle-visual.ts`, `dev/vehicles.html`, `dev/vehicles.ts`

**Interfaces:**
- Consumes: `VehicleVisual` (`src/render/seams.ts`); `truckAnchors`, `trailerAnchors`, `COUPLING_HEIGHT`; `placePose` (`src/render/coords.ts`); `createThreeSceneRenderer`, `placeholderParts`, `placeholderLayout`, `mountPerfOverlay` (Task 6); `truckById`, `trailerById`, `resolveCombination` (Task 7).
- Produces: `proceduralTruck(spec: TruckSpec, palette: ScenePalette): VehicleVisual`, `proceduralTrailer(spec: TrailerSpec, palette: ScenePalette): VehicleVisual`.

- [ ] **Step 1: Implement**

All dimensions come from data and anchors; `MeshLambertMaterial` in palette colours.

Truck:
- Cab: 2.2 m long from the bumper, 2.9 m high, colour `cab`.
- Chassis: `chassis`.
- Body: `platform` (flat bed) or `tipper` (open box), colour `body`, from behind the cab to `rearX`.
- Wheels: radius 0.5, colour `wheel`, at the axle anchors and tracks (twin rears). The front wheel group yaws by `snapshot.roadWheelAngle`.

Trailer:
- Dolly group at `snapshot.dolly`: an A-frame drawbar from the eye to the turntable, the front axle and its wheels.
- Body group at `snapshot.trailer`, deck at `deckHeight`: `box` (swap body 2.7 m above the deck) or `low-loader` (flat deck with upright ramps at the rear). Rear axles at `rearAxles`.

Geometry merged per material; at most 6 draw calls per vehicle.

- [ ] **Step 2: Dev harness** — `dev/vehicles.html` renders one pair, chosen by `?truck=&trailer=` (default: the first of each), in the placeholder environment. It sweeps steer and both pivot angles slowly. Poses come from the Task 13 position formulas, inlined in `dev/vehicles.ts` (`H = P₀ − c u(θ₀)`, `P₁ = H − d u(θ₁)`, `P₂ = P₁ − L₂ u(θ₂)`, with `VehicleParams` from `resolveCombination`).

- [ ] **Step 3: Manual verification**

Run `pnpm dev`, open `/dev/vehicles.html`.
Expected:
- Wheels sit on the axle anchors.
- The drawbar eye meets the truck coupling at every steer angle, and the body pivots over the turntable.
- The Hüffermann shows a tandem; front wheels turn with the steer.
- The page's `mountPerfOverlay` stays at 58 fps or more on the desktop.

- [ ] **Step 4: Deliver** — PR `feat: procedural truck and trailer visuals` from `task/14-vehicle-visuals`.

---

### Task 15: Environment and top-down aids

**Depends on:** 6, 10 · **Parallel with:** 13, 14, 16–18

**Files:**
- Create: `src/render/environment.ts`, `src/render/aids.ts`, `dev/environment.html`, `dev/environment.ts`

**Interfaces:**
- Consumes: `Environment`, `AidsLayer`, `AIDS_LAYER` (`src/render/seams.ts`); `ResolvedLayout`, `RenderFrame`; `trailerAnchors`, `truckAnchors`; `toThree`, `placePose`; `layouts`, `exercises`, `resolveLayout` (Task 10); Task 6 renderer and placeholder vehicles.
- Produces: `proceduralEnvironment(layout: ResolvedLayout, palette: ScenePalette): Environment`; `proceduralAids(truck: TruckSpec, trailer: TrailerSpec, layout: ResolvedLayout, palette: ScenePalette): AidsLayer`.

- [ ] **Step 1: Implement the environment**

- Ground: a `verge` plane over `bounds`; surfaces at y = 0.005 (`yard`, `pavement`, `street`).
- Markings: quads at y = 0.01 with `polygonOffset`; dashed lines are 3 m dash, 6 m gap, colour `marking`.
- Obstacles: boxes of their `obb` and `height`, merged per kind (kerb, wall, fence, hall, ramp, parked, cone); lamp posts as a pole with a head.
- Target: the zone outline as 0.15 m accent strips on layer 0.
- Lighting: `HemisphereLight` (sky / verge) and a `DirectionalLight` from the south-west at 50°, no shadows.

At most 20 draw calls.

- [ ] **Step 2: Implement the aids (all on `AIDS_LAYER`)**

- Predicted path: a 0.2 m accent ribbon along `frame.predicted`, drawn only when `aids.path`.
- Wheel tracks: 0.1 m ribbons in `tracks` for the truck rear wheels and the trailer rear wheels. Preallocated buffers hold up to 2,000 points per wheel, sampled every 0.25 m, shown when `aids.tracks`; history accumulates while hidden.
- Target ghost: the trailer body outline (from `frontX`/`rearX` and width) placed so its rear-end centre is at `layout.target.pose`, accent at 50 % opacity, shown when `aids.ghost` and a target exists.

- [ ] **Step 3: Dev harness** — `dev/environment.html?layout=depot|logistics&exercise=<id>` renders the resolved layout with the placeholder vehicles at the start pose and a fake predicted arc.

- [ ] **Step 4: Manual verification**

Run `pnpm dev`, open each layout and exercise in `/dev/environment.html`.
Expected:
- Street, kerbs (gap at the entrance), lane markings, the yard edge, the hall with gates or ramp, the wall or fence, lamp posts and parked blocks are visible in the windscreen, both mirrors and the top-down view.
- The target zone is accent-coloured.
- Aids appear only in the top-down view, and each toggles.

- [ ] **Step 5: Deliver** — PR `feat: procedural yard environment and top-down aids` from `task/15-environment`.

---

### Task 16: HUD

**Depends on:** 2, 4, 5, 6 · **Parallel with:** 13–15, 17, 18

**Files:**
- Create: `src/hud/hud.ts`, `src/hud/gauges.ts`, `src/hud/hud.css`, `dev/hud.html`, `dev/hud.ts`

**Interfaces:**
- Consumes: `SimSnapshot`, `ViewRects`, `AidFlags`, `TopDownMode`; `t`, `formatNumber`, `applyMessages` (Task 5) with keys including `keySpace`, `keys`, `steer`, `speed`, `brake`, `gear`; `computeViewports` (Task 6, harness only).
- Produces:
  - `src/hud/hud.ts`: `createHud(root: HTMLElement, opts: { couplingLimit: number; turntableLimit: number; mode: 'exercise' | 'yard'; aids: AidFlags; topDown: TopDownMode }): Hud`, with `Hud = { update(s: SimSnapshot): void; layout(views: ViewRects): void; onAction(cb: (a: HudAction) => void): void; dispose(): void }` and `HudAction = { type: 'topDown'; mode: TopDownMode } | { type: 'aid'; aid: keyof AidFlags; on: boolean } | { type: 'finish' } | { type: 'menu' }`.
  - `src/hud/gauges.ts`: `gaugeLevel(angle: number, limit: number): 'ok' | 'warn' | 'danger'` (`|angle| / limit` < 0.6 → ok, < 0.85 → warn, else danger).
  - The speed readout element carries `data-hud="speed"` with text `${formatNumber(|speed|·3.6, 1)} km/h`.

Placement (from `layout(views)`, hairline chrome at the edges):
- Cockpit: a dashboard band across its bottom 18 % (`--color-surface-muted`, 1px `--color-border` top) with the mono speed readout and the current gear letter (P / R / N / D; `--color-accent` unless P); mirror frames as 1px `--color-border` rounded rects over the mirror rects.
- Blocked toast: centred near the cockpit top while `blocked` is set (`blockedContact` / `blockedCoupling` / `blockedTurntable`).
- Top-down: a toggle row along its top edge (`viewFollow`/`viewYard`, four aid toggles); the two pivot gauges in its top-left (visible when `aids.pivots`); in exercise mode, mono counters (contacts, jackknifes, direction changes, time) at its top-right. Its bottom-left corner stays clear, because the lever overlays it in landscape.
- Top-right of the screen: `finish` (exercise) or `menu` (yard).
- Key legend: shown only when `matchMedia('(hover: hover) and (pointer: fine)')` matches. Its bindings (labels from `t`, keys in mono): A / D or ← / → → `steer`; W / S or ↑ / ↓ → `speed`; `keySpace` → `brake`; 1–4 = P / R / N / D → `gear`.

Gauges: SVG semicircle from −limit to +limit with a needle at the angle and a mono readout with sign and `°`. The arc and needle use `--color-success` / `--color-warning` / `--color-danger` by `gaugeLevel`. This is the signature element.

- [ ] **Step 1: Implement** to the placement and gauge rules; tokens only.

- [ ] **Step 2: Dev harness** — `dev/hud.html` lays the HUD over grey rects from `computeViewports` and feeds a synthetic snapshot that sweeps both pivot angles to ±limit and cycles `blocked`.

- [ ] **Step 3: Manual verification**

Run `pnpm dev`, open `/dev/hud.html` at 1024×640, 640×1024 and 1440×900, in light and dark (`data-theme`), in de and en.
Expected:
- Gauges pass ok → warn → danger at 60 % and 85 % of the limit.
- Nothing overlaps the mirror rects or the control corners (bottom-left lever, bottom-right wheel).
- Text is legible on both themes.

- [ ] **Step 4: Deliver** — PR `feat: HUD with pivot-angle gauges` from `task/16-hud`.

---

### Task 17: README with estimated parameters

**Depends on:** 7 · **Parallel with:** 13–16, 18

**Files:**
- Create: `README.md`, `src/vehicles/estimates.ts`
- Test: `src/vehicles/estimates.test.ts`

**Interfaces:**
- Consumes: `trucks`, `trailers` (Task 7).
- Produces: `estimatesTable(): string` (Markdown table: Vehicle | Parameter | Value | Basis, one row per `status: 'estimate'` parameter in data order; values in mm, °, turns, turns/s or a count).

- [ ] **Step 1: Write the failing test**

```ts
it('README lists every estimated parameter', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const section = readme.split('<!-- estimates:start -->')[1]?.split('<!-- estimates:end -->')[0]?.trim();
  expect(section).toBe(estimatesTable().trim());
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/vehicles/estimates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `estimatesTable` and write `README.md`**

README sections:
- What it is (one paragraph).
- Live URL.
- Develop: `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm test:e2e`, `pnpm test:perf` (headed, hardware GL, local only), `/?probe`, `?perf=1`.
- Vehicles and sources (the five spec URLs).
- Estimated parameters: the generated table between the markers, nested as `<!-- prettier-ignore-start -->`, `<!-- estimates:start -->`, table, `<!-- estimates:end -->`, `<!-- prettier-ignore-end -->` so `format:check` leaves it byte-identical. Then one line that measured values replace estimates in `src/vehicles/*.ts` without code changes, and one line that the turning radius is taken at the outer front wheel centre.
- Licence: Apache-2.0; Geist under OFL.
- `© 2026 Patrick Kuhn`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/vehicles/estimates.test.ts`
Expected: PASS.

- [ ] **Step 5: Deliver** — PR `docs: README with estimated parameters` from `task/17-readme`.

---

### Task 18: Every pair drives in every layout and exercise

**Depends on:** 7, 8, 9, 10, 13 · **Parallel with:** 14–17

**Files:**
- Test: `src/content/content.test.ts`
- Modify (only if the test exposes bad coordinates): `src/content/layouts/*.ts`, `src/content/exercises/*.ts`

**Interfaces:**
- Consumes: `layouts`, `exercises`, `resolveLayout` (Task 10); `LAYOUT_IDS`, `EXERCISE_IDS` (Task 2); `trucks`, `trailers`, `resolveCombination` (Task 7); `createSimulation`, `bodyFootprints` (Task 13); `createContactQuery`, `obbOverlap` (Task 8); `targetError` (Task 9).

- [ ] **Step 1: Write the test**

```ts
const cases = [
  ...Object.values(layouts).map((l) => ({ name: l.id, resolved: resolveLayout(l, null), start: l.start, exercise: null })),
  ...exercises.map((e) => ({ name: e.id, resolved: resolveLayout(layouts[e.layout], e), start: e.start, exercise: e })),
];
describe.each(cases)('$name', ({ resolved, start, exercise }) => {
  it('has unique obstacle ids', ...);
  it.each(pairs)('%s + %s starts clear and drives forward and backward', (truck, trailer) => {
    const params = resolveCombination(truck, trailer);
    const query = createContactQuery(resolved.obstacles);
    const sim = createSimulation(params, { truck: start }, query);
    expect(query(bodyFootprints(params, sim.snapshot()))).toBeNull();
    // gear D lever 0.3 until the truck moved 0.5 m: contacts 0, jackknifes 0
    // fresh sim, gear R lever 0.3 until moved 0.5 m: contacts 0, jackknifes 0
  });
  if (exercise) {
    it('target zone lies in the yard and overlaps no obstacle', ...);
    it.each(pairs)('%s + %s does not start inside the target tolerance', ...);
  }
});
it('registers exactly the contract ids', () => {
  expect(Object.keys(layouts).sort()).toEqual([...LAYOUT_IDS].sort());
  expect(exercises.map((e) => e.id)).toEqual([...EXERCISE_IDS]);
});
it('reversing into a real wall raises one contact and recovers forward', () => {
  // test-local wall obstacle behind the start; real query + sim: blocked 'contact', contacts 1; gear D → blocked null
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/content`
Expected: PASS. On failure, fix the coordinates in the named layout or exercise file, never the test rules, and re-run.

- [ ] **Step 3: Deliver** — PR `test: every pair drives in every layout and exercise` from `task/18-content-test`.

---

### Task 19: App shell: menu, settings, drive loop

**Depends on:** 6–16, 18 · **Parallel with:** —

**Files:**
- Create: `src/app/app.ts`, `src/app/menu.ts`, `src/app/drive.ts`, `src/app/settings.ts`, `src/app/storage.ts`, `src/app/theme.ts`, `src/app/app.css`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: everything produced above, under the names given there.
- Produces:
  - `src/app/app.ts`: `startApp(root: HTMLElement): void`.
  - `src/app/drive.ts`: `startDrive(root: HTMLElement, run: RunConfig, settings: Settings, onExit: (outcome: DriveOutcome) => void): () => void`, where `RunConfig = { layoutId: LayoutId; exercise: ExerciseDefinition | null; truckId: TruckId; trailerId: TrailerId }` and `DriveOutcome = { log: InputLog; final: SimSnapshot; result: RunResult | null }`.
  - `src/app/storage.ts`: `safeStorage(): Storage | null`, `readText(key: string): string | null`, `writeText(key: string, value: string): void`; keys `gegenlenker.settings.v1`, `gegenlenker.best.v1`, `gegenlenker.lastRun.v1`.
  - `src/app/settings.ts`: `Settings = { version: 1; language: Lang; theme: 'system' | 'light' | 'dark'; truckId: TruckId; trailerId: TrailerId; aids: AidFlags; topDown: TopDownMode }`, `loadSettings(raw: string | null, detected: Lang): Settings`, defaults `aids {pivots: true, path: true, tracks: false, ghost: true}`, `topDown 'follow'`, `theme 'system'`, the first truck and trailer.
  - `src/app/theme.ts`: `applyTheme(pref: Settings['theme']): void` (sets `data-theme` on `<html>`, follows `prefers-color-scheme` while `'system'`).

- [ ] **Step 1: Implement**

Entry:
- `main.ts`: `?probe` → `startProbe`; otherwise import tokens, base CSS and fonts, then `startApp(#app)`.
- `startApp`: loads settings (`detectLanguage(navigator.languages)`), applies theme and language, renders the menu, and calls `startUpdatePrompt`.

Menu:
- `<h1>` `appName` and the `tagline`.
- Truck and trailer `<select>` with the `estimateNote` beside them.
- `freeYard` buttons for both layouts; one `exercises` button per exercise (title plus its best result, or `noResult`). A button starts immediately with the selected pair.
- Language select (options `langDe`, `langEn`) and theme select (`themeSystem`, `themeLight`, `themeDark`).
- Footer `© 2026 Patrick Kuhn`.
- Every storage access goes through `safeStorage`; failures fall back to defaults.

Drive:
- Full-window canvas with `createThreeSceneRenderer({ truck: proceduralTruck, trailer: proceduralTrailer, environment: proceduralEnvironment, aids: proceduralAids })` and `setScene(resolveLayout(...), truck, trailer, readScenePalette())`.
- `createControls` and `createHud`.
- `createSimulation(params, { truck: start }, createContactQuery(resolved.obstacles))`, plus `createInputRecorder` and `createRunTracker` (exercise only).

Frame loop (`requestAnimationFrame`):
- `advanceClock` gives the step count. For each step: `controls.tick(DT)`, `control = controls.control()`, `recorder.record(sim.snapshot().step, control)` (before stepping), `snapshot = sim.step(control)`, and in an exercise `if (tracker.update(snapshot))` finish.
- `predicted`: when `aids.path` and gear D/R, `predictTrailerRear(params, snapshot, ±1, 15)`.
- Then `renderer.render({ snapshot, views, topDown, aids, predicted })` and `hud.update(snapshot)`.

Events:
- `ResizeObserver` and `orientationchange`: `computeViewports` → `renderer.resize`, `hud.layout`; views go into each frame.
- `visibilitychange` hidden: stop the loop. Visible: restart with a fresh timestamp.
- HUD actions update and persist the settings. `finish` or `menu` calls `onExit` with the recorder's log, the final snapshot and `runResult` (exercise) or `null`.
- `onExit` stores the last run (`gegenlenker.lastRun.v1`) and, for exercises, `recordBest` into `gegenlenker.best.v1`, then returns to the menu.

Failures:
- `init` throws: show `noWebgl`.
- `stats().contextLost`: show `contextLost` with a `reload` button.
- `?perf=1` mounts `mountPerfOverlay`.

- [ ] **Step 2: Manual verification**

Run `pnpm dev --host`. Check on desktop at 1440×900, in DevTools at Galaxy Tab S9 landscape and portrait, and on the reference tablet.
Expected:
- Cockpit, both mirrors and the top-down view are visible together in every orientation.
- All four pairs drive forward and backward in both yards and all five exercises.
- While driving, every pair's drawbar eye meets the truck coupling and the trailer body pivots over the turntable.
- Each of the five exercises can be driven to "target reached" with MAN + Krone and with Arocs + Hüffermann. An exercise that cannot be completed becomes an issue against its Task 10 file; this task does not edit content.
- An exercise ends on reaching the target, and the best result shows in the menu.
- Rotating the tablet mid-run keeps the run going, with the views re-laid out.
- Switching apps and returning resumes without a jump.
- Garbage in `gegenlenker.settings.v1` / `.best.v1` (set by hand in DevTools) loads the menu with defaults.
- Language and theme switch everywhere.
- `?perf=1` on the tablet reads 58 fps or more during an exercise.

- [ ] **Step 3: Deliver** — PR `feat: app shell, menu and drive loop` from `task/19-app-shell`.

---

### Task 20: Results and replay

**Depends on:** 19 · **Parallel with:** 21

**Files:**
- Create: `src/app/result-view.ts`, `src/app/replay-view.ts`, `src/app/results.css`
- Modify: `src/app/app.ts`, `src/app/menu.ts`

**Interfaces:**
- Consumes: `DriveOutcome`, `startDrive`, storage keys and the renderer wiring (Task 19); `replaySnapshots`, `parseInputLog`, `createSimulation` (Task 13); `recordBest`, `parseBestResults`, `serializeBestResults`, `bestKey` (Task 9); `truckById`, `trailerById`, `resolveCombination` (Task 7); `layouts`, `exerciseById`, `resolveLayout` (Task 10); `createContactQuery` (Task 8); `computeViewports(…, 'replay')`.
- Produces: `showResult(root: HTMLElement, result: RunResult, isNewBest: boolean, actions: { retry(): void; replay(): void; menu(): void }): () => void`; `startReplay(root: HTMLElement, log: InputLog, onExit: () => void): () => void`.

- [ ] **Step 1: Implement**

Result:
- After an exercise exits, `showResult` shows `targetReached` or `targetMissed`, position error (m, 2 digits) and angle error (°, 1 digit), contacts, jackknifes, direction changes and time (s, 1 digit), all mono.
- `newBest` when it is one. Actions `retry`, `replay`, `menu`.

Replay:
- `startReplay` rebuilds the run from the log (ids → specs, layout, exercise, start) and precomputes `replaySnapshots`.
- It renders the top-down view only (`'replay'` viewports) with aids `{ tracks: true, ghost: true, path: false, pivots: false }`.
- Controls: `play` / `pause`, 1× / 4× (advancing `60 · speed · dt` snapshots per frame) and `back`.
- The menu shows `replayLastRun` when `parseInputLog(readText('gegenlenker.lastRun.v1'))` is not null; it opens the replay.

- [ ] **Step 2: Manual verification**

Run `pnpm dev`, finish an exercise with contacts and direction changes.
Expected:
- The result values match the HUD counters.
- Replay retraces the run in the top-down view, ending at the same pose.
- `replayLastRun` survives a reload. Corrupting `gegenlenker.lastRun.v1` by hand hides the button and never throws.

- [ ] **Step 3: Deliver** — PR `feat: results and top-down replay` from `task/20-results-replay`.

---

### Task 21: Offline browser check

**Depends on:** 11, 19 · **Parallel with:** 20

**Files:**
- Create: `e2e/offline.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `en` messages (`src/i18n/en.ts`); `data-hud="speed"` (Task 16); gear key `2`, lever key `w` (Task 12).

- [ ] **Step 1: Write the test**

```ts
test('loads from the subpath and drives an exercise offline', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) foreign.push(r.url()); });
  await page.goto('./');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: en.appName })).toBeVisible();
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('[data-hud="speed"]')).toHaveText('0.0 km/h');
  await page.keyboard.press('2');
  for (let i = 0; i < 5; i++) await page.keyboard.press('w');
  await expect(page.locator('[data-hud="speed"]')).not.toHaveText('0.0 km/h');
  expect(foreign).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm exec playwright install chromium && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 3: Add it to CI**

Append to the `check` job, after `pnpm build`:
- `actions/cache@v6` for `~/.cache/ms-playwright`, keyed on `pnpm-lock.yaml`.
- `pnpm exec playwright install --with-deps chromium`.
- `pnpm test:e2e`.
- On failure, upload `test-results/` with `actions/upload-artifact@v7`.

- [ ] **Step 4: Deliver** — PR `test: offline drive from the Pages subpath` from `task/21-offline-e2e`; CI `check` must pass on it.

---

### Task 22: Final verification against the Definition of done

**Depends on:** all · **Parallel with:** —

**Files:** none. A failure becomes a GitHub issue and a follow-up task PR with `Closes #<n>`.

- [ ] **Step 1: Automated**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: exit 0. This covers:
- Turning circle, constraints, divergence, events and replay (Task 13).
- Every pair in every layout and exercise (Task 18).
- Token values and AA contrast (Task 4).
- README estimates (Task 17).
- The offline subpath drive with no foreign request (Task 21).

- [ ] **Step 2: Deployed site**

Run: `gh run list --workflow deploy.yml --limit 1 --json conclusion --jq '.[0].conclusion'` → `success`; then `curl -fsS https://docgerd.github.io/gegenlenker/manifest.webmanifest | grep -q '"scope":"/gegenlenker/"'`.

- [ ] **Step 3: Reference tablet (owner-run, Android Chrome)**

On the tablet:
1. Open `https://docgerd.github.io/gegenlenker/?perf=1`.
2. Drive the dock exercise with Arocs + Hüffermann in landscape and in portrait. Expected: overlay ≥ 58 fps; scale reported.
3. Install or visit once, switch on airplane mode, reload, and drive an exercise. Expected: it works.
4. Check that the mirrors are correctly handed: the trailer appears on the inner edge of the mirror on the side it swings to.

Record the outcome as a comment on the final PR or issue, not in docs.

- [ ] **Step 4: Spec walk-through**

Tick each Definition-of-done line of the spec against Steps 1–3:
- Views visible together on desktop and on the tablet in landscape and portrait.
- Every exercise completes with MAN + Krone and with Arocs + Hüffermann (no open issue from Task 19's check).
- Light and dark, de and en.
- No THW look; footer copyright present; estimates noted in the menu.

Open an issue per gap.
