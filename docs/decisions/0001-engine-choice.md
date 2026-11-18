# 0001: Engine choice (Unreal Engine 5 vs three.js WebGPU)

- Status: proposed (owner's current choice: stay on three.js, migrate to `WebGPURenderer`)
- Date: 2026-11-19
- Issue: #162 (spike: assess rebuilding in Unreal Engine 5 + Blender; desk research only; no UE5 install, no prototype)

## Context

Gegenlenker is a TypeScript + three.js PWA (Vite, offline, Apache-2.0). Targets set by the owner:

- Desktop browser (owner-stated reference device: RTX 4090), High preset, at least 60 fps.
- Android tablet (owner-stated reference device: Galaxy Tab S7) lower priority, but it must keep working. The older plan doc (`docs/superpowers/plans/2026-11-16-gegenlenker.md`) used a Galaxy Tab S9 profile; the owner now names the S7.
- Assets: CC0 and CC-BY only; Blender is the authoring tool.

Question: would a full Unreal Engine 5 rebuild beat the current stack, and which middle paths exist?

## Options

1. **A. Rebuild in UE5.** Native Android/desktop app; Blender assets via import.
2. **B. three.js `WebGPURenderer`** (WebGPU backend, WebGL 2 fallback), staged migration from `WebGLRenderer`.
3. **C. Stay on `WebGLRenderer`**, raise quality with Blender-baked assets (AO, PBR textures, KTX2).
4. **D. Babylon.js** (WebGPU or WebGL engine).

## Evidence

### UE5 mobile and web

- Nanite is not supported on the mobile renderer; it needs SM6 by default, which UE does not officially support on Android ([Arm, 2026-03-18](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/mali-and-unreal-engine-s-nanite-enabling-the-future-of-mobile-graphics)).
- Lumen on Android is experimental since UE 5.4, only on high-end Vulkan SM5 devices (Adreno 7xx, Mali G7xx, Xclipse 9xx) and only via the desktop renderer, which "incurs a significant performance cost compared to mobile forward or deferred rendering"; Epic does not yet recommend shipping with it ([Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-lumen-global-illumination-on-mobile-in-unreal-engine)). The Tab S7 (Adreno 650, Vulkan 1.1 per [Notebookcheck](https://www.notebookcheck.net/Adreno-650-vs-Adreno-720-vs-Adreno-732_9971_12490_12763.247598.0.html)) is not on that list.
- So the Lumen/Nanite visual ceiling applies on desktop only; the tablet gets mobile forward rendering with baked lighting, which Blender-baked three.js assets can approach.
- No maintained web export: the HTML5 target was removed during UE4 and never shipped for UE5 (unconfirmed by Epic; [Summer Engine summary](https://www.summerengine.com/make-great-games/unreal-engine-html5-export.md), vendor blog); users still ask for it in 2025 with no Epic reply ([forum](https://forums.unrealengine.com/t/could-you-bring-back-html5-support-for-ue5/2518727)). Epic's browser route is Pixel Streaming (server-side GPU, video to the client), which breaks offline play and adds per-user server cost.
- APK size: no current UE5 measurement found; UE4-era forum reports range from about 19 MB (hand-stripped) to about 150 MB for an empty project ([example](https://forums.unrealengine.com/t/why-an-empty-project-weights-about-200mb/474322)). Measure in a prototype if option A is revisited.
- Licence: a royalty applies only to revenue above a threshold, so for a free app it is not the blocker; re-check the current [EULA](https://www.unrealengine.com/license) if that changes.

### three.js `WebGPURenderer`

- Official manual: the renderer is "still in an experimental state" though maturity greatly improved; WebGL 2 is the automatic fallback; `WebGLRenderer` "is still maintained and the recommended choice" for pure WebGL 2 apps, but no larger new features are planned for it ([manual](https://threejs.org/manual/pages/webgpurenderer.html)).
- Not supported in `WebGPURenderer`: `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile()` patches and `EffectComposer` (same manual); these must be rewritten as node materials/TSL.
- Android Chrome: WebGPU is on by default since Chrome 121 on Android 12+ with Qualcomm or ARM GPUs, with wider Android support planned ([Chrome blog](https://developer.chrome.com/blog/new-in-webgpu-121)). Whether the Tab S7's Android and Chrome versions qualify is unverified; the WebGL 2 fallback covers the rest.
- The fallback is a different renderer than `WebGLRenderer`, not the same code path: one user benchmark (r183, RTX 4090 laptop, many-mesh scene) measured about 2x the CPU render cost and a 5-10x slower first frame on both the WebGPU and `forceWebGL` paths ([thread](https://discourse.threejs.org/t/webgpurenderer-2x-slower-cpu-and-5-10x-slower-first-frame-than-webglrenderer-on-many-mesh-scenes-r183-same-on-both-backends/91904)); single user, scene-dependent, no maintainer reply.

### Babylon.js

- WebGPU engine since 5.0; WebGL and WebGPU are "maintained side by side"; the engine is chosen at startup and a WebGPU scene cannot be swapped to WebGL, so fallback is app code ([Babylon docs](https://doc.babylonjs.com/setup/support/webGPU)). Moving to it rewrites the whole render layer for no capability gain over option B.

### Blender baking pipeline (option C)

- glTF can carry a baked AO map (occlusion in the red channel, shareable with roughness/metallic); Cycles bakes it, and a `glTF Settings` node group with an `Occlusion` input feeds the exporter ([Blender manual](https://docs.blender.org/manual/en/4.2/addons/import_export/scene_gltf2.html)). glTF has no standard lightmap slot.
- The repo already has the Blender-to-glb pipeline (`tools/blender/`, `pnpm glb:optimise`) and a KTX2 texture build (`tools/textures/`), so baked AO/PBR maps extend an existing pipeline.

### Port cost (from the repo)

Shares of non-test `src/` lines (reproduce: `find src -name '*.ts' ! -name '*.test.ts' | xargs wc -l`), approximate:

| Area                                          | Share | UE5 (A)                            | three WebGPU (B)               |
| --------------------------------------------- | ----- | ---------------------------------- | ------------------------------ |
| `render/`                                     | ~50%  | rewrite (Blueprint/C++, materials) | renderer swap + shader port    |
| `sim/ scoring/ vehicles/ contracts/ content/` | ~20%  | port to C++ (or WASM plugin)       | unchanged                      |
| `app/ hud/ input/ pwa/ i18n/`                 | ~30%  | rewrite (UMG, touch, packaging)    | unchanged                      |
| Tests (unit, Playwright e2e, CI, Pages)       | large | rebuilt from scratch               | e2e adapts, unit mostly intact |

- A also loses: fingerprinted runs unless the C++ sim is bit-identical, the offline PWA install/update flow, URL-reachable web play, and the `pnpm install` contributor setup (replaced by a UE editor install and heavy CI runners).
- B's cost is concentrated: custom shaders in `render/{skyline,vehicle-pbr,environment}.ts` (`onBeforeCompile`) and `render/sky.ts` (`ShaderMaterial`) must become TSL; `render/mirror.ts` and `render/vehicle-pbr.ts` use `WebGLRenderTarget`, scissor compositing and sky-map generation that need re-verification; `three-renderer.ts`, `ground-texture.ts` and `seams.ts` type against `WebGLRenderer`.
- Estimates (judgement, not measured): A is a multi-month rewrite (order of half a year solo); B is weeks, dominated by shader/mirror porting and perf re-tuning.

## Decision

Do not rebuild in UE5. Migrate to three.js `WebGPURenderer` as planned, staged and gated; keep `WebGLRenderer` shipping until the gate passes.

1. Spike branch: port the four shader sites to TSL and the mirror/sky-map render targets; keep the `WebGLRenderer` path behind a flag.
2. Gate before switching the default (measured, not assumed): top-down output hash per preset unchanged; at least 60 fps on the High preset on the RTX 4090 desktop; the `forceWebGL` fallback on the Tab S7 meets the existing `?perf=1` pass criterion (tablet check in `CLAUDE.md`); draw-call-heavy scenes checked for the CPU overhead reported above.
3. Quality work that does not depend on the migration (baked AO, PBR maps, KTX2) proceeds under option C now and carries over.

Rejected: A (no web, no offline PWA, Lumen/Nanite do not reach the tablet, full rewrite, no clear gain over baked three.js assets on desktop); D (full render rewrite, no gain over B).

## Consequences

- Reach stays web-first: one codebase, PWA offline install, `pnpm` contributor flow, existing tests and CI.
- Visual ceiling stays below UE5 Lumen/Nanite on desktop; accepted, narrowed by baked assets.
- Dependence on a renderer the maintainers still call experimental; mitigated by the flag and the gate.
- Once the migration starts, new code uses node materials, not `ShaderMaterial`/`onBeforeCompile`.

## Revisit triggers

- The owner wants a native-only product, a store release, or console/VR targets.
- Epic ships a maintained web export, or Lumen/Nanite-class features on the mobile renderer.
- The migration gate fails (fps, first-frame stall, shader parity) or `WebGPURenderer` regresses on the tablet fallback.
- three.js marks `WebGPURenderer` stable or deprecates `WebGLRenderer`.
- Visual targets (#159 realistic cockpit, #160 richer yard environment) prove unreachable with baked three.js assets.
