---
name: verify-viewport-layout
description: 'Use when a change touches src/render/viewports.ts, the controls or token CSS it copies, the HUD key legend, or mirror and message placement: reruns the bounded exhaustive layout verification (pnpm verify:layout).'
---

# Verify the viewport layout

`src/render/viewports.verify.ts` runs the real `computeViewports`, `topDownSplit` and `messageColumn` at every integer CSS width and height in its bounds, for a named list of config variants, and checks the layout promises as named properties. `src/render/viewports.test.ts` and `e2e/layout.spec.ts` sample sizes; this does not.

## When

Run it when a change touches any of these (the covered files):

- `src/render/viewports.ts`: `computeViewports`, `topDownSplit`, `messageColumn`, `messagesFit`, `controlsHeight`, `wheelSize`, `wrapLines`, and their constants.
- `src/render/cockpit-band.ts`, `src/render/cockpit-camera.ts`, `src/render/close-mirror.ts`: the front and close mirror bands, minimum widths, and the cockpit camera (55 degree FOV) the sight cone is modelled from.
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

The summary prints one line per property, in `PROPERTIES` order: `ok`, `KNOWN #n`, `FAILED`, `STALE`, `NEVER APPLIED` or `not applied`, then `(failures of checks)`. A failing run then throws a block of details: one `FAILED <property> in variant [<name>]` or `STALE ...` line each, with the failing box and the first counterexamples (size, rects, overlap in px). The output is long; `pnpm verify:layout 2>&1 | grep -E '^(FAILED|STALE|NEVER)'` lists only what fails (summary and detail lines both match). Exit 0 is a pass.

Exit 0 at the baseline means every counterexample is in `KNOWN_FINDINGS` (in the spec): a (property, variant) pair mapped to the issue that tracks it, separately for the default and the full bounds.

- `KNOWN #n`: counterexamples only in listed pairs. It does not fail.
- `FAILED`: a counterexample outside the listed pairs. A property that never failed now fails, or a listed property fails in a new variant: your change broke a promise, or a new variant exposes an old finding (add the pair with its issue only after filing one). Reproduce the first counterexample with a custom box, fix the code, never the bound or the property.
- `STALE`: a listed pair has no counterexample in its bounds, so the issue is fixed (or the variant changed). Remove that variant from `KNOWN_FINDINGS` (and the property key when it is empty) in the same commit as the fix; close the issue. It is judged only in the named bounds, so run both default and full before removing an entry listed for both.
- `NEVER APPLIED` (named bounds only): the spec no longer reaches the property, a verification error: restore the coverage. Custom boxes print `not applied` and are never judged on it. Two properties are hit counters and print `not applied` on a clean run: `mirrors-above-controls-band (height at MIN_MIRROR_HEIGHT)` and `cockpit-keeps-room-for-controls (deficit over 0.5 px)`; for them only `FAILED` matters.
- The other tests in the file (`fallbacks match the CSS`, the `hud.ts` thresholds) failing means `tokenPx` fallbacks or constants copied from `tokens.css`, `controls.css` or `hud.ts` differ from the source: node runs on those, so every property result is then about the wrong geometry. Fix that first.

To compare with the baseline, run it with the same bounds and environment as the changed run (`git stash` is shared, so use a second worktree or a scratch mutation reverted with `git restore <file>`; the guard hook denies `git checkout -- <file>`). Custom boxes classify against the full table and skip the STALE check.

## Real bug or verification error

A real bug: the counterexample's rects, read against the promise in CLAUDE.md or the doc comment, are wrong. A verification error: the spec's model is wrong, for example

- a measured legend box or state rule in `LEGEND_BOXES` and `legendFor` that `hud.ts` changed, or a new `hud.css` toast padding the message-stack oracle (`stackHeight`) lacks;
- a new config input (a mirror, a setting, a preset flag) that no variant in `VARIANTS` carries;
- a promise that the spec encodes but the code documents otherwise.

To re-measure the legend: start `pnpm dev`, open the drive at each size in en and de with headless Chromium, read the `.hud-legend` box (the stage-bottom distance of its top, width, height), and click `[data-hud="keysToggle"]` through `page.evaluate` for the open-chevron state; update `LEGEND_BOXES`.

Check the first counterexample in a browser (`pnpm exec playwright screenshot` or `e2e/layout.spec.ts` at that size) before changing the spec.

## Change properties or variants

When a change intentionally alters a promise, edit the property in the spec in the same commit and say why in the commit message; do not add an exemption. A property at an escape the code documents (`MIN_MIRROR_HEIGHT` at `viewports.ts`) stays a separate named property whose failure is still a failure. To add a config input, add a `base(...)` entry to `VARIANTS`. To change what a property means, check it still fails on a mutation of `viewports.ts` (drop the offset, swap a min and max, remove a clamp), then revert it with `git restore src/render/viewports.ts`.

## Scope

- Exhaustive over width x height inside the bounds above; outside them nothing is claimed. The sight cone is the circle of `CLEAR_CONE_DEG` about the cockpit camera axis for class IV (issue #265), the square bounding box for the message stack. Phones are not a target and are not covered.
- Config inputs are sampled: `VARIANTS` lists mode (drive, mirrors, replay), the extras per preset (and none) and the class IV setting, share clamp extremes, a measured legend per size (and with the chevron open on a short cockpit), a stand-in panel stack and a never-fitting one, and no, home-indicator and notch insets.
- `tokenPx` and `readSafeInsets` use their node fallbacks; a test checks them against the CSS files. The legend boxes and states are measured assumptions, checked only for the four `hud.ts` thresholds.
- Constants the spec imports from `viewports.ts` (`MIN_CLASS_II_SHARE`, `MIN_MESSAGE_WIDTH`, `MIN_FRONT_WIDTH`, `MIN_WIDE_WIDTH`, `WIDE_GAP_PX`, `MIN_MIRROR_HEIGHT`) move with the code: changing their value is not detected. A wrong use of them is.
- Not covered: class II against the sight cone (no documented rule says class II must clear it; the owner decides, see issue #392); real browser layout and CSS (`e2e/layout.spec.ts` does that), the measured panel heights (`hud.panelsBottom`), the cockpit label's width and the toast boxes' real widths (the message stack is modelled from `hud.css` padding and `wrapLines`).

## Coverage record

Sync commit: `d51c44b`, the last commit that touched the covered files when this verification was written. A skill cannot hold its own SHA, so staleness is measured against the covered files:

```
git log --oneline d51c44b..HEAD -- src/render/viewports.ts src/render/cockpit-band.ts src/render/cockpit-camera.ts src/render/close-mirror.ts src/render/quality.ts src/contracts/render.ts src/i18n/en.ts src/i18n/de.ts src/styles/tokens.css src/input/controls.css src/hud/hud.css src/hud/hud.ts
```

At the sync commit the check exits 0: every counterexample is a known finding, filed as issues #389 to #394 and listed in `KNOWN_FINDINGS`.

Empty output: the verification still describes the code. Commits listed: run the check at `HEAD`, read each listed commit for changes to the legend states, texts or geometry the spec copies, and update the spec. Move the sync commit to the latest listed commit only after confirming the verification describes the code at that commit.
