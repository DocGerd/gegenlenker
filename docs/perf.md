# Performance checks

## Emulated tablet (local)

`pnpm perf:tablet` drives the built app in Chromium on the real GPU, emulating the reference Android tablet: 1280x800 at device scale 2, touch, a mobile user agent and a CDP CPU throttle. For each graphics preset and vehicle pair it reads the `?perf=1` overlay (fps, p95 frame time, resolution scale, draw calls) after the resolution governor settles. It builds the app into a temporary directory and previews it on a free port. A pass is necessary, not sufficient: the physical tablet check in `CLAUDE.md` still applies. Source: `e2e/perf/tablet-emulation.ts`. It is not part of CI or `pnpm verify`.

```
pnpm perf:tablet [--throttle <n>] [--preset low|balanced|high|all] [--runs <n>]
                 [--quick | --pair <truck id>+<trailer id>] [--functional] [--no-perf] [--allow-software] [--skip-build]
                 [--backend webgl2|webgpu|auto] [--keep-traces]
```

- `--throttle` is the CPU slowdown factor (default 4; use 6 for a pessimistic device).
- `--runs` repeats every cell; a cell passes only if every run passes, which exposes governor flakiness.
- `--no-perf` needs `--functional`. `--functional` adds checks for offline service worker, history back from a drive, wake lock and two-thumb touch (wheel and lever together). Any console error, failed request or lost or software WebGL context during a perf cell or check also fails it, as does a vehicle that does not move.
- `--pair` limits the run to one vehicle pair. A run that ends below scale 1.00 keeps the resolution governor's trace (events and sampled frame intervals, from `window.__governor` under `?perf=1`) in a JSON file under the temp directory and prints its path; `--keep-traces` keeps it for every run. The file also lists every overlay reading with its scale and time, so a step down followed by a step up shows. Measuring starts once the preset's attachments are in place (the `readyMarkers` of `e2e/pinned-shoot.ts`).
- A cell passes at at least 58 fps with the resolution scale still at 1.00. The exit code is 1 when any cell or check fails (or every check skips), 2 when the harness itself fails or the options are invalid.
- It aborts on a software renderer (SwiftShader, llvmpipe), where fps is meaningless; `--allow-software` overrides that for debugging the harness.
- `--backend` sets the app's `?backend=` (see below) and fails a cell drawn on another backend; `auto` fails one not drawn on WebGPU, since it runs the WebGPU gate. The table names each cell's backend. For WebGPU it adds `--enable-unsafe-webgpu`, and on WSL `--use-webgpu-adapter=opengles`: WSL has no hardware Vulkan driver, so Dawn's OpenGL ES backend is its only hardware adapter, and that one runs in compatibility mode (no canvas MSAA).

Runs in Chromium's new headless mode, so no window opens or takes focus. On WSL it sets the GPU launch (see "Headless and the GPU") when `/usr/lib/wsl/lib` exists; elsewhere Chromium picks its default GPU path.

## Graphics backend

The renderer is three.js's `WebGPURenderer`. `?backend=` picks its GPU API:

- `webgl2` (default): the WebGL 2 backend.
- `webgpu`: WebGPU on any adapter, software included (tests, tablet checks).
- `auto`: WebGPU on a hardware adapter with core features, else WebGL 2.

A WebGPU start that fails, or a lost WebGPU device, goes on with WebGL 2 for the rest of the session without a notice; the console says why. The `?perf=1` overlay and `<html data-render-backend>` name the live backend, and the overlay and `<html data-render-fallback>` say why it is WebGL 2 although WebGPU was asked for (`unavailable`, `failed` or `lost`; `auto` declining an adapter is no fallback). An unknown `?backend=` value warns and gives the default.

WebGPU becomes the default (`DEFAULT_BACKEND_REQUEST` in `src/render/gpu-backend.ts` to `auto`) once it passes this gate on a core hardware adapter:

- Desktop: real-GPU Chromium passes every High cell (`pnpm perf:tablet --throttle 1 --preset high --backend auto`).
- Tablet: `pnpm perf:tablet --throttle 6` still passes on WebGL 2, and the physical tablet check passes on both backends.
- Look: `scripts/shoot-views.mjs` top-down shots on WebGPU differ from WebGL 2 at edges only.

WSL offers no core hardware adapter, so the gate is unmet there; Chrome on Windows (D3D12) or Android (Vulkan) can run it.

`pnpm shoot --out <dir> --backend webgpu` (`scripts/shoot.mjs`: builds, serves on a free port, shoots, always stops its own server; it takes the `shoot-views.mjs` arguments except `--url`) is the local WebGPU look check. CI's `offline` e2e project has no WebGPU adapter, so it covers the fallback; the advisory `webgpu` CI job (`pnpm test:e2e:webgpu`, `e2e/webgpu/`) runs a smoke on the same SwiftShader adapter: every preset starts on WebGPU, visits each view, and fails on a `THREE.` WGSL error. The shoot draws every view on SwiftShader's WebGPU adapter in Chromium's new headless mode and fails when the app does not run on WebGPU, logs a three.js problem or a page error, or draws the top-down view differently per preset. To compare with WebGL 2, shoot that side with `--new-headless` (the new headless mode wraps HUD text differently, which moves the top-down framing) and diff with `--diff`.

## Frame target

Every pane is drawn into one app-owned 8-bit, 4-sample sRGB target (`src/render/frame-target.ts`), and one output pass draws it to the canvas. The target stores sRGB codes, so darks keep the codes a linear 8-bit buffer rounds away. It is renderer-wide, never per preset or a user setting: the top-down view must not depend on it. Its colour space also stops three adding an output pass per pane, so `drawCalls` counts one.

It costs fill rate: SwiftShader frames, which CI e2e draws on, are slower than with a linear target, so the heavy e2e specs (`@heavy`, in `e2e/pinned-shoot.ts`) run in shards of their own (`.github/workflows/ci.yml`). Real-GPU frame time is checked with `pnpm perf:tablet` (see above), and a physical tablet still decides.

## Headless and the GPU

`pnpm test:perf`, `pnpm perf:tablet` and `E2E_GPU=1` run in Chromium's new headless mode unless `HEADED=1` (a headed window grabs desktop focus under WSLg); the CI projects are always headless. On WSL2 (`e2e/gpu-launch.ts`) all three get the real GPU headless: Mesa d3d12 (`GALLIUM_DRIVER=d3d12`, `LD_LIBRARY_PATH=/usr/lib/wsl/lib`) behind ANGLE on EGL (`--use-gl=angle --use-angle=gl-egl`) with `DISPLAY` and `WAYLAND_DISPLAY` removed from the browser's environment; with a display ANGLE tries GLX, finds no EGL config and falls back to SwiftShader. It needs the `render` group for the GPU render node. `HEADED=1` keeps the display and desktop GL (`--use-angle=gl`). The `perf` project applies the same launch on WSL: with only `--ignore-gpu-blocklist` Chromium there gets llvmpipe.

## Other tools

- `pnpm preview:stop [--port <n>]` stops the listener on this checkout's e2e preview port (the one `pnpm test:e2e` prints) or the given port, and nothing else; use it instead of `pkill -f` on an orphaned preview.
- `E2E_GPU=1 pnpm test:e2e` (WSL2 with a GPU): the `offline` project on the real GPU (Mesa d3d12), much faster than SwiftShader; it fails fast on a software renderer (see "Headless and the GPU"). It drops the layout checks in `GPU_TEXT_METRICS` (`playwright.config.ts`) and can flake pixel-hash specs (the cockpit drag test), so CI's SwiftShader run stays the gate.
- `pnpm test:perf` (headless; `HEADED=1` for a window) runs `e2e/perf/four-views.perf.ts` against the `?probe` page (see `src/render/probe.ts`) and owns the automated thresholds for the four-view layout.
- The manual check on a physical tablet is in `CLAUDE.md` ("Tablet perf check").
