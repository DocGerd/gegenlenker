# Performance checks

## Emulated tablet (local)

`pnpm perf:tablet` drives the built app in headed Chromium on the real GPU, emulating the reference Android tablet: 1280x800 at device scale 2, touch, a mobile user agent and a CDP CPU throttle. For each graphics preset and vehicle pair it reads the `?perf=1` overlay (fps, p95 frame time, resolution scale, draw calls) after the resolution governor settles. It builds and previews the app itself on a free port. Source: `e2e/perf/tablet-emulation.ts`. It is not part of CI or `pnpm verify`.

```
pnpm perf:tablet [--throttle <n>] [--preset low|balanced|high|all] [--runs <n>]
                 [--quick] [--functional] [--no-perf] [--allow-software] [--skip-build]
```

- `--throttle` is the CPU slowdown factor (default 4; use 6 for a pessimistic device).
- `--runs` repeats every cell; a cell passes only if every run passes, which exposes governor flakiness.
- `--functional` adds checks for offline service worker, history back from a drive, wake lock and two-thumb touch (wheel and lever together). Any console error during a perf cell also fails it.
- A cell passes at at least 58 fps with the resolution scale still at 1.00. The exit code is 1 when any cell or check fails, 2 when the harness itself fails.
- It aborts on a software renderer (SwiftShader, llvmpipe), where fps is meaningless; `--allow-software` overrides that for debugging the harness.

Needs a display (headed Chromium). On WSL it sets the GPU environment (`GALLIUM_DRIVER=d3d12`, `LD_LIBRARY_PATH=/usr/lib/wsl/lib`, ANGLE on desktop GL) when `/usr/lib/wsl/lib` exists; elsewhere Chromium picks its default GPU path.

## Other tools

- `pnpm test:perf` runs `e2e/perf/four-views.perf.ts` against the `?probe` page (see `src/render/probe.ts`) and owns the automated thresholds for the four-view layout.
- The manual check on a physical tablet is in `CLAUDE.md` ("Tablet perf check").
