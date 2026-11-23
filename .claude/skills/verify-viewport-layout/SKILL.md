---
name: verify-viewport-layout
description: 'Use when a change touches src/render/viewports.ts, the controls or token CSS it copies, the HUD key legend, or mirror and message placement: reruns the bounded exhaustive layout verification (pnpm verify:layout).'
---

# Verify the viewport layout

`src/render/viewports.verify.ts` runs the real `computeViewports`, `topDownSplit` and `messageColumn` at every integer CSS width and height in its bounds, for a named list of config variants, and checks the layout promises as named properties. `src/render/viewports.test.ts` and `e2e/layout.spec.ts` sample sizes; this does not.

## When

Run it when a change touches any of these (the covered files):

- `src/render/viewports.ts`: `computeViewports`, `topDownSplit`, `messageColumn`, `messagesFit`, `controlsHeight`, `wheelSize`, `wrapLines`, and their constants.
- `src/render/cockpit-band.ts`, `src/render/close-mirror.ts`: the front and close mirror bands and minimum widths.
- `src/render/quality.ts`: the mirror flags per preset (`extrasOf` in the spec copies `extraMirrors`).
- `src/contracts/render.ts`: `ViewRects`, `TOP_DOWN_SHARE_LIMITS`, `DEFAULT_TOP_DOWN_LAYOUT`.
- `src/i18n/en.ts`, `src/i18n/de.ts`: the toast and goal-cue texts that `wrapLines` wraps.
- `src/styles/tokens.css`, `src/input/controls.css`, `src/hud/hud.css`: the control, wheel, legend and toast geometry the code and the spec copy.
- `src/hud/hud.ts`: the legend states (`SHORT_SCREEN`, `SHORT_HEIGHT`, `COMPACT_WIDTH*`) and `legendBox()`.

## Run

- `pnpm verify:layout`: the default bounds, one worker; it is not part of `pnpm test`.
- `VERIFY_LAYOUT=full pnpm verify:layout`: the full range, several times slower.
- `VERIFY_LAYOUT_W=1280-1400 VERIFY_LAYOUT_H=585-700 pnpm verify:layout`: one custom box, for bisecting a failure.

Bounds, in CSS px, every integer width x height in each box:

- Default: laptop 1280-1600 x 585-800, desktop 1900-1940 x 1060-1100 and 2400-2560 x 1300-1440, tablet landscape 1000-1200 x 600-800, tablet portrait 600-820 x 900-1200.
- Full: 1024-2560 x 426-1440, tablet landscape 800-1023 x 426-1000, tablet portrait 600-1280 x 800-1600.

## Read the output

Each property prints `ok`, `FAILED` or `NEVER APPLIED` with how many checks failed. A failed property lists the box its failures lie in, the variants that failed most, and the first counterexamples (size, variant, rects, overlap in px). Properties are named for their promise (`mirrors-clear-of-legend`, `message-stack-clear-of-sight-cone`); the list is `PROPERTIES` in the spec.

- `FAILED` on a property that passed before your change: your change broke the promise. Reproduce the first counterexample with a custom box, fix the code, never the bound or the property.
- `FAILED` on one that failed before too: compare counts and boxes with the run on `origin/develop`; only a new counterexample is yours.
- `NEVER APPLIED` in the default bounds: the spec no longer reaches that property (a variant or a size range stopped producing the case). That is a verification error: restore the coverage. Two properties are hit counters and print it on a clean run: `mirrors-above-controls-band (height at MIN_MIRROR_HEIGHT)` and `cockpit-keeps-room-for-controls (deficit over 0.5 px)`; for them only `FAILED` matters.
- The other tests in the file (`fallbacks match the CSS`) failing means `tokenPx` fallbacks or constants copied from `tokens.css`, `controls.css` or `hud.ts` differ from the source: node runs on those, so every property result is then about the wrong geometry. Fix that first.

## Real bug or verification error

A real bug: the counterexample's rects, read against the promise in CLAUDE.md or the doc comment, are wrong. A verification error: the spec's model is wrong, for example

- a measured legend box or state rule in `LEGEND_BOXES` and `legendFor` that `hud.ts` changed, or a new `hud.css` toast padding the message-stack oracle (`stackHeight`) lacks;
- a new config input (a mirror, a setting, a preset flag) that no variant in `VARIANTS` carries;
- a promise that the spec encodes but the code documents otherwise.

To re-measure the legend: start `pnpm dev`, open the drive at each size in en and de with headless Chromium, read the `.hud-legend` box (the stage-bottom distance of its top, width, height), and click `[data-hud="keysToggle"]` through `page.evaluate` for the open-chevron state; update `LEGEND_BOXES`.

Check the first counterexample in a browser (`pnpm exec playwright screenshot` or `e2e/layout.spec.ts` at that size) before changing the spec.

## Change properties or variants

When a change intentionally alters a promise, edit the property in the spec in the same commit and say why in the commit message; do not add an exemption. A property at an escape the code documents (`MIN_MIRROR_HEIGHT` at `viewports.ts`) stays a separate named property whose failure is still a failure. To add a config input, add a `base(...)` entry to `VARIANTS`. To change what a property means, check it still fails on a mutation of `viewports.ts` (drop the offset, swap a min and max, remove a clamp), then revert the mutation.

## Scope

- Exhaustive over width x height inside the bounds above; outside them nothing is claimed. Phones are not a target and are not covered.
- Config inputs are sampled: `VARIANTS` lists mode (drive, mirrors, replay), the extras per preset (and none) and the class IV setting, share clamp extremes, a measured legend per size (and with the chevron open on a short cockpit), a stand-in panel stack and a never-fitting one, and no, home-indicator and notch insets.
- `tokenPx` and `readSafeInsets` use their node fallbacks; a test checks them against the CSS files. The legend boxes and states are measured assumptions, checked only for the four `hud.ts` thresholds.
- Constants the spec imports from `viewports.ts` (`MIN_CLASS_II_SHARE`, `MIN_MESSAGE_WIDTH`, `MIN_FRONT_WIDTH`, `MIN_WIDE_WIDTH`, `WIDE_GAP_PX`, `MIN_MIRROR_HEIGHT`) move with the code: changing their value is not detected. A wrong use of them is.
- Not covered: real browser layout and CSS (`e2e/layout.spec.ts` does that), the measured panel heights (`hud.panelsBottom`), the cockpit label's width and the toast boxes' real widths (the message stack is modelled from `hud.css` padding and `wrapLines`).

## Coverage record

Sync commit: `d51c44b`, the last commit that touched the covered files when this verification was written. A skill cannot hold its own SHA, so staleness is measured against the covered files:

```
git log --oneline d51c44b..HEAD -- src/render/viewports.ts src/render/cockpit-band.ts src/render/close-mirror.ts src/render/quality.ts src/contracts/render.ts src/i18n/en.ts src/i18n/de.ts src/styles/tokens.css src/input/controls.css src/hud/hud.css src/hud/hud.ts
```

At the sync commit the check exits non-zero; these properties fail, and a change is judged against them:

- Default bounds: `cockpit-keeps-room-for-controls (deficit up to 0.5 px, pane rounding)`, `mirrors-clear-of-sight-cone`, `message-column-valid`.
- Also in the full range: `mirrors-above-controls-band (height at MIN_MIRROR_HEIGHT)`, `mirrors-clear-of-control-boxes`, `message-stack-clear-of-sight-cone`, `message-stack-clear-of-controls-and-hud-band`, `message-stack-clear-of-legend`.

Empty output: the verification still describes the code. Commits listed: run the check at `HEAD`, read each listed commit for changes to the legend states, texts or geometry the spec copies, and update the spec. Move the sync commit to the latest listed commit only after confirming the verification describes the code at that commit.
