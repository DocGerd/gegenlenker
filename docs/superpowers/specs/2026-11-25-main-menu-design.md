# Main menu — design

"Decided" = stated by the owner; "Decided (owner, 2026-11-25)" = settled on review of this draft. "Call" = proposed by the author, open to correction. No code here; this document is the spec a rebuild in another engine would follow.

## Intent

Today's menu is one flat scrolling page: every exercise, both free yards, the replay bar, eight dropdowns and the footer. On a laptop the vehicle choice, the replay bar and all settings sit below the fold, Esc does nothing, and nothing says where to start. It reads as a web form.

The menu becomes a game main menu: a title screen that offers the next step, and one sub-screen per decision (what to drive, how to drive it, how the app behaves).

## Goals

- Decided: a title screen with sub-screens (approach A).
- Decided: the title has at least an Exercises entry leading to a list of the predefined exercises, a Free yard entry, and a separate Settings entry.
- Decided: the term stays "Übungen" / "Exercises".
- Decided: the structure leaves room for the Einweiser mode (#443) without building it.
- Decided: the structure is engine-neutral, so a move to Unreal Engine 5 can rebuild it from this document.
- Decided (owner, 2026-11-25): Continue starts the drive directly, without the setup screen.
- Decided (owner, 2026-11-25): the title has a static illustration and the menu stays free of three.js; a live 3D backdrop is deferred.
- Decided (owner, 2026-11-25): options are choice rows (radio groups), not dropdowns.
- Decided (owner, 2026-11-25): after a run, "Menu" and Esc land on the title.
- Call: a returning trainee is driving after one activation; a new trainee after three, without scrolling or tabbing.
- Call: every screen works with keyboard alone, pointer alone and touch alone; Esc and the back gesture always go up exactly one level.
- Call: the title never scrolls at a 1280×585 CSS viewport, in both languages, while no toast shows (with one it may scroll by the toast's reserve). Lists, run setup and settings aim for the same; where German does not fit, they scroll inside the screen.
- Call: controls help, what's new and credits are reachable from the title.
- Call: settings that can change during a drive are reachable from the pause sheet.

## Non-goals

Einweiser implementation; audio; progression locks; profiles or accounts; rebinding keys; gamepad input; deep links or restoring a sub-screen after a reload; a live 3D or animated backdrop (deferred); a phone layout; new settings beyond re-homing the existing ones; switching graphics quality inside a running drive; changes to the result screen other than where "Menu" lands; exercise preview images (a follow-up, drawn from layout data).

Progression locks stay out on purpose: trainees and instructors pick the exercise the session calls for, and a lock would block training. Curriculum order and the done marker carry the progression.

## Anti-goals

- A menu that parses three.js or touches the GPU.
- An entry that leads nowhere yet ("coming soon", an empty role).
- A level that offers a single choice.
- Hover-only information or actions.
- Motion that delays input.
- A Continue that hides what it starts.
- A setting that silently has no effect where it is offered.
- Scores and bests as the centre of a screen (the owner cares little about them).

## Constraints

- The menu's static import graph stays free of `three`, `src/render/index.ts`, `src/hud` and `drive.ts`; drive and replay stay behind dynamic `import()`. Preset facts the menu needs come from `src/render/quality.ts`, which imports types only; the key legend comes from `src/input`.
- No new framework or dependency. Plain DOM, as today.
- All text through `t()`; every key in `en.ts` and `de.ts`; wording per `docs/glossary.md`, with a row for each new term.
- `query(root, name, Type)` throws unless the element is `instanceof Type`: pass the real class (`HTMLInputElement` for a radio, `HTMLFieldSetElement` for its group).
- Screens render inside `.app-screen`, so the update toast in the root survives every swap. Each screen's scroll container pads its bottom by `--toast-reserve`, so its last control stays clear of the toast.
- Safe-area padding uses the `--safe-*` tokens. Layout is sized by CSS viewport, never screen resolution. Landscape and portrait switch on `(min-aspect-ratio: 1/1)`.
- Targets are at least `--size-target`. One `:focus-visible` ring for every menu control.
- History: the app holds at most one history entry of its own (`enter`/`leave` in `app.ts`). The title holds none, so back from the title leaves the app.
- PWA: everything a menu screen shows is in the precache. Licence texts are `.txt` under `public/licenses/`, which `PRECACHE_GLOBS` does not cover.
- Screen swaps are synchronous: no timer, no `requestAnimationFrame`, no transition gates input. `startPinnedDrive` walks the menu with timers and rAF frozen.
- Brand: tokens only, AA contrast in both themes, no THW look.
- Core contracts (`ExerciseDefinition`, `dataFingerprint`, input log, best key) do not change.

## Approaches

- **A. Title screen with sub-screens** (decided by the owner). One decision per screen, a clear primary action, a back rule that maps to Esc, the back gesture and a gamepad's B button. Costs two extra activations on a first start; Continue removes them for a returning trainee.
- **B. Tabs on one page.** Rejected by the owner: it still reads as a web page. It also has no natural back level, and tabs are a poor fit for a console-style UI in another engine.

## Screen map

```
title ─┬─ Continue ················· starts a drive (no screen)
       ├─ Replay last run ·········· starts the replay (no screen)
       ├─ Exercises ── exercise list ─┐
       ├─ Free yard ── yard list ─────┴─ run setup ── Start ── drive
       ├─ Settings ─── (General, Graphics) ── Controls
       ├─ Controls
       ├─ What's new
       └─ About

drive ── pause sheet ── Settings (the options that apply to a drive)
drive ── result ── Menu ── title
```

Controls is one screen with two openers (title, Settings). Back returns to whichever opened it.

Wireframes are at laptop size (1280×585) in German. They fix content and order, not styling.

### Title

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Gegenlenker                                                                   │
│  Rangiertrainer für Lkw mit Drehschemelanhänger                                │
│                                                                                │
│  ┌────────────────────────────────────────┐                                    │
│  │ Weiter                                 │         static illustration,       │
│  │ 3 Rückwärts um die Ecke                │         decorative: the            │
│  │ MAN LE 18.280 · Krone AZW 18           │         combination from above     │
│  │ Nacht · Mit Draufsicht                 │                                    │
│  └────────────────────────────────────────┘                                    │
│  Letzte Fahrt ansehen · Rückwärts in eine Bucht                                │
│                                                                                │
│  ┌────────────────────────────────────────┐                                    │
│  │ Übungen                              › │                                    │
│  │ Freier Hof                           › │                                    │
│  │ Einstellungen                        › │                                    │
│  └────────────────────────────────────────┘                                    │
│  Bedienung     Neuigkeiten [Neu]     Über                                      │
│                                                                                │
│  Version x.y.z · [Abnahmetest] · Offline bereit                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

- `h1` is the app name; the tagline follows it.
- Call: Continue and "Replay last run" form one "last session" block, shown only when there is something to continue or replay. A first visit shows neither, and Exercises is the primary action.
- Call: "Replay last run" lives here, under Continue: it belongs to the last session, not to an exercise, and stays one activation away as today. Its detail line stays exactly as today: the entry without a number, plus Night and Mirrors only when they apply.
- Decided (owner, 2026-11-25): Continue's label shows the exercise, then truck · trailer · time of day · driving view.
- Call: all four are always shown, as value labels without field names ("Tag", "Mit Draufsicht"); nothing is left out for being the default.
- Decided (owner, 2026-11-25): the illustration is static. Live 3D behind the title is deferred.
- The What's new badge keeps its meaning.
- The footer keeps build label, UAT badge and offline status. Call: the copyright line moves to About.
- The returning state in German is the tightest case of the title's no-scroll rule. If it does not close, the footer joins the secondary row; the content does not change.

### Exercise list

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  ‹ Zurück                                                                      │
│  Übungen                                                                       │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ 1  Gerade rückwärts                                        ✓ Geschafft   │  │
│  │    Den Anhänger geradeaus rückwärts in die markierte Bucht setzen …      │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │ 2  Rückwärts in eine Bucht                                 ✓ Geschafft   │  │
│  │    Den Anhänger zwischen den parkenden Fahrzeugen rückwärts in die …     │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │ 3  Rückwärts um die Ecke                                                 │  │
│  │    Rückwärts um die Ecke in die Seitenstraße fahren und in der …         │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │ 4  An die Rampe setzen                                                   │  │
│  │ 5  Slalom vor und zurück                                                 │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
```

- An ordered list in curriculum order (`EXERCISE_IDS`). Each row is one button: number, title, done marker, brief. The brief is not cut off; it wraps.
- No tolerance and no best here. A best depends on truck, trailer, time of day and driving view, which are chosen on the next screen; the done marker (`exerciseDone`, any combination) does not.
- A row opens run setup. It never starts a drive.
- Call: when the list does not fit the viewport it scrolls inside the screen; Back and the heading stay in view.

### Yard list

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  ‹ Zurück                                                                      │
│  Freier Hof                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ Betriebshof                                                              │  │
│  │ Frei im Betriebshof fahren, ohne Ziel.                                   │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │ Logistikhof                                                              │  │
│  │ Frei im Logistikhof fahren, ohne Ziel.                                   │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
```

The same screen kind as the exercise list: one row per layout (`LAYOUT_IDS`) with name and brief, no number, no done marker.

### Run setup

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  ‹ Zurück                                                                      │
│  3  Rückwärts um die Ecke                                                      │
│                                                                                │
│  Rückwärts um die Ecke in die        Lkw          (•) MAN LE 18.280            │
│  Seitenstraße fahren und in der                   ( ) Mercedes-Benz Arocs …    │
│  markierten Bucht anhalten.          Anhänger     (•) Krone AZW 18             │
│                                                   ( ) Hüffermann HPA 24.81 L   │
│  Toleranz ± 0,7 m · ± 5°             Tageszeit    (•) Tag      ( ) Nacht       │
│                                      Fahransicht  (•) Mit Draufsicht           │
│  Bestwert · ohne Hilfen: …                        ( ) Nur Spiegel              │
│  Bestwert · mit Hilfen: …            Einige Maße sind geschätzt.               │
│                                      ┌──────────────────────────────────────┐  │
│                                      │               Starten                │  │
│                                      └──────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
```

- `h1` is the entry (number and title for an exercise, "Freier Hof · <yard>" for a yard).
- Left: brief, tolerance, and today's best lines for the chosen combination, unchanged in content and refreshed on every option change. A yard has neither tolerance nor bests.
- Right: the step's options, all visible, prefilled from the stored settings, written on change as today. Then the estimate note and Start.
- Decided (owner, 2026-11-25): options are choice rows (a labelled radio group with every value visible), not dropdowns. Every option has two or three values, one activation replaces two, arrow keys work natively, no native popup competes for Esc, and it ports to an engine UI as an option row. A group that outgrows a row becomes a list of the same radios.
- Setup is a sequence of steps. Today there is one ("conditions"), shown without a step indicator. With more than one, Start becomes Next until the last step, and back steps through them first.
- Call: Start shows a busy state until the drive has mounted: Start is disabled and marked busy, and Esc, Back and the back gesture are ignored. A failed load ends it with the existing failure notice. Continue on the title behaves the same.
- Call: where the screen does not fit, it scrolls inside the screen.
- Portrait: one column in reading order (brief, options, Start).

### Settings

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  ‹ Zurück                                                                      │
│  Einstellungen                                                                 │
│                                                                                │
│  ALLGEMEIN                                                                     │
│  Sprache              (•) Deutsch    ( ) English                               │
│  Darstellung          (•) System     ( ) Hell       ( ) Dunkel                 │
│                                                                                │
│  GRAFIK                                                                        │
│  Grafikqualität       ( ) Niedrig    (•) Ausgewogen ( ) Hoch                   │
│  Weitwinkelspiegel    (•) An         ( ) Aus                                   │
│                                                                                │
│  Bedienung                                                                   › │
└────────────────────────────────────────────────────────────────────────────────┘
```

- The same choice rows as run setup. A change applies at once and is stored; there is no Save.
- Call: the first group is "General / Allgemein", not "Display". Language is not a display property, the German for theme is already "Darstellung", and "display" is taken by the angle display aid.
- A language change re-renders the screen in place and keeps focus on the chosen value; the navigation stack is untouched.
- Call: Controls is a row that opens the Controls screen, not a third category with its own pane: it holds no setting, and one screen serves both openers.
- Truck, trailer, time of day and driving view are not here: they describe a run, not the app.

### Controls

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  ‹ Zurück                                                                      │
│  Bedienung                                                                     │
│                                                                                │
│  TASTATUR                                TOUCH UND MAUS                        │
│  A / D · ← / →      Lenken               Lenkrad    um die Mitte ziehen        │
│  C                  Lenkung zentrieren   Hebel      ziehen oder scrollen       │
│  W / S · ↑ / ↓      Tempo                Stopp      halten zum Bremsen         │
│  Leertaste          Bremse               Tasten     Fahrstufe, Licht           │
│  1–4 = P / R / N / D  Fahrstufe          Lenkrad und Hebel gehen gleichzeitig. │
│  …                                                                             │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Call: the keyboard group lists the keys for the saved driving view and graphics quality, exactly the rows the drive's legend will show. For that, the legend's row selection and its term renderer (`legendRow` and the top-view filter in `src/hud/hud.ts`) move to `src/input`, beside `legendRows` and the term types, so menu and HUD share them.
- Touch and mouse: wheel, lever, Stop, gear and lamp buttons, two thumbs at once; the content of the Controls section in `docs/usage.md`.
- Read-only; scrolls if needed. Portrait: the groups stack.

### What's new

Unchanged content. It gains the shared back rules (Esc closes it; today it does not).

### About

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  ‹ Zurück                                                                      │
│  Über                                                                          │
│                                                                                │
│  Gegenlenker · Version x.y.z                                                   │
│  Rangiertrainer für Lkw mit Drehschemelanhänger                                │
│  © <year> <owner> · Quellcode ↗                                                │
│                                                                                │
│  LIZENZ                 <the app's licence>                                    │
│  LIZENZEN DRITTER       <one entry per file in public/licenses/> …             │
│  QUELLEN DER ASSETS     <one entry per asset: name, licence, author> …         │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Asset entries come from the registry behind `docs/asset-credits.md`.
- Call: About may link to the public source repository and to the asset sources. CC0 assets are listed as courtesy credits.
- Loaded on demand like What's new, readable offline, no fetch. Scrolls.

### Pause sheet › Settings

```
┌──────────────────────────────┐      ┌──────────────────────────────────────────┐
│ Pausiert                     │      │ ‹ Zurück                                 │
│ [ Weiter                   ] │      │ Einstellungen                            │
│ [ Neustart                 ] │      │ Darstellung       (•) System ( ) Hell …  │
│ [ Beenden                  ] │  →   │ Weitwinkelspiegel (•) An     ( ) Aus     │
│ [ Ohne Wertung verlassen   ] │      │ Grafikqualität    ( ) Niedrig (•) …      │
│ [ Einstellungen            ] │      │   Gilt ab dem nächsten Start             │
│ Ein Neustart wird nicht …    │      └──────────────────────────────────────────┘
└──────────────────────────────┘
```

The sheet's content swaps inside the same modal dialog; the drive stays paused. This level is not a screen of the menu graph: the drive owns it and reuses the options kind, filtered by where each option applies. Only options that mean something to a running drive appear:

| Setting                                   | Menu     | Pause | Takes effect                                             | Why (`drive.ts`, `render-stage.ts`)                                                                                   |
| ----------------------------------------- | -------- | ----- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Theme                                     | Settings | yes   | at once                                                  | `applyTheme` is CSS only                                                                                              |
| Wide-angle mirrors                        | Settings | yes   | at once, after a drive change                            | `arrange()` reads the settings captured at start; it must read the live value and run again. Only the layout changes. |
| Graphics quality                          | Settings | yes   | from the next start (Restart or next drive), labelled so | `mountRenderStage` sets the preset once per mount; view and mirror availability are fixed when the HUD is built       |
| Language                                  | Settings | no    | at once in the menu                                      | HUD and control texts are built at mount                                                                              |
| Truck, trailer, time of day, driving view | Setup    | no    | next run                                                 | They identify the run: input log and best key                                                                         |
| Aids, view mode, panel folds, divider     | Drive    | —     | at once, as today                                        | Unchanged                                                                                                             |

Restart already remounts with the current settings, so "from the next start" needs no new mechanism.

### Tablet

- Landscape (reference 1024×768): the laptop layouts, with a narrower or absent illustration.
- Portrait (reference 768×1024): one column everywhere; the illustration sits above the entries or is dropped; a choice row stacks its values when they do not fit.
- Below tablet width nothing is designed, but every screen stays usable down to 360 CSS px: one column, no horizontal overflow, vertical scrolling allowed. This also covers a narrow desktop window.

## User journeys

Activations are clicks, taps or key presses. "Today" is measured at 1280×585, where the vehicle fields, the replay bar and the settings are below the fold.

| Journey                                | Today                              | New                                                                     |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| First visit, first exercise, defaults  | 1                                  | 3: Exercises, exercise, Start (keyboard: Enter three times)             |
| Returning, carry on                    | 1, after finding the card          | 1: Continue (keyboard: Enter)                                           |
| A specific exercise, same setup        | 1                                  | 3                                                                       |
| An exercise with another truck         | 3 and two scrolls                  | 4, no scroll                                                            |
| A night run with mirrors only          | 5 and two scrolls                  | 5, no scroll                                                            |
| Free yard                              | 1, a scroll on a short laptop      | 3; 1 by Continue when it was the last drive                             |
| Change language or graphics quality    | 2 and a scroll                     | 2, no scroll                                                            |
| Replay the last run                    | 1 and a scroll                     | 1                                                                       |
| What's new                             | 1 and a scroll to the footer       | 1                                                                       |
| Read the controls before driving       | not possible                       | 1                                                                       |
| Change theme or mirrors during a drive | leave the run, change, start again | Pause, Settings, value: the run continues                               |
| After a run                            | Next exercise, Retry or Menu       | unchanged; Menu lands on the title, where Continue offers the next step |

The new flow costs two activations on a first start and when picking a specific exercise. That is the price of one decision per screen; Continue, Next exercise and Retry keep repeated practice at one.

### What Continue starts

- Call: the last driven entry. If that is an exercise that is done, the next exercise that is not done, searching forward from it in curriculum order and wrapping past the end; if none is left, the last driven one. A free yard continues as that yard.
- "Last driven" alone strands the trainee on a finished exercise. "Next undone" alone pulls a trainee off the exercise they are still practising and cannot express a free-yard session.
- Decided (owner, 2026-11-25): Continue starts the drive directly with the stored setup.
- Call: "after a first run" means a drive was started, not finished: the last entry is stored once a drive has mounted (from Start, Continue, Next exercise), so a load or WebGL failure leaves it alone. `lastRun()` is no substitute: it exists only for a finished run and is dropped when the sim revision changes.
- Call: the last entry is a new field of the stored settings (validated field by field like the rest, so old stored settings stay valid). When it is missing but a last run is stored, that run's entry stands in.

## Navigation, focus and keys

### Levels and back

The menu keeps a stack of levels in memory. It holds the app's history entry whenever the top level is not the title.

| Where                                            | Esc, in-app Back                           | Browser or Android back                                                                |
| ------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Title                                            | nothing                                    | leaves the app (no entry held)                                                         |
| Lists, Settings, Controls, What's new, About     | to the opener                              | to the opener; the entry is pushed again unless the opener is the title                |
| Run setup                                        | to the list                                | to the list; the entry is pushed again                                                 |
| Run setup, a later step (future)                 | to the previous step                       | to the previous step                                                                   |
| Run setup or title, busy after Start or Continue | ignored                                    | setup: ignored, the entry is pushed again; title: leaves the app, as it holds no entry |
| Drive                                            | opens or closes the pause sheet (as today) | as today                                                                               |
| Pause sheet › Settings                           | to the pause actions                       | to the pause actions                                                                   |
| Result; replay opened from the title             | to the title (as today)                    | as today                                                                               |
| Load-failed or no-WebGL notice: Back             | to the title                               | —                                                                                      |
| Reload on any sub-screen                         | —                                          | lands on the title; the stale entry is dropped (the existing rule)                     |

- Going up to the title releases the entry (`leave`); going up to any other level keeps it. A popped entry is pushed again when the new level is not the title: the drive's `onPop` pattern.
- Start replaces the held entry with the drive's, as `enter` does today.
- Decided (owner, 2026-11-25): after a run, "Menu" and Esc land on the title, never on the list or the setup screen behind it.
- Escape is matched with `isAction('escape', e)`, ignores repeats and handled events. If a native popup ever returns to the menu, Esc closes the popup first.
- Browser Forward never opens a screen: levels live in memory, not in history. This is today's behaviour for drive and result and stays as it is.

### Focus

| Screen                      | Focus on entry                                                             | Focus on return from a child     |
| --------------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| Title                       | Continue when shown, else Exercises                                        | the entry that opened the child  |
| Exercise list               | the exercise Continue would start, else the first not done, else the first | the row that opened setup        |
| Yard list                   | the last driven yard, else the first                                       | the row that opened setup        |
| Run setup                   | Start                                                                      | —                                |
| Settings                    | the checked value of the first row                                         | the Controls row                 |
| Controls, What's new, About | the heading (not a control: these are for reading)                         | —                                |
| Pause sheet › Settings      | the checked value of the first row                                         | the Settings button of the sheet |

- Call: focus goes to the primary action where a screen has one. A reading screen has none, so its heading takes focus and Back is the first tab stop (as What's new does today); an options screen starts on the first row's checked value.
- The pause sheet keeps its focus trap; it covers the whole dialog, and its fallback target is the current content's first control.
- Held keys never act twice. A menu control ignores a repeated Enter or Space keydown and a Space release whose press began on another screen. This carries the result screen's Space guard to every menu screen: a run ends with the brake key held, and Continue is focused next.
- A double click moves one level: the second click of a multi-click does not activate what appeared under the pointer. The selection clearing in `enter` stays.

### Keys and pointer

| Input                      | Effect                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Enter, Space, click, tap   | activates the focused or pressed item                                                                                              |
| Up, Down                   | title and lists: previous, next item in reading order; stops at the ends                                                           |
| Home, End                  | title and lists: first, last item                                                                                                  |
| Arrow keys in a choice row | change the value (native radio behaviour); Tab moves between rows and to Start. Setup and Settings have no other arrow navigation. |
| Tab, Shift+Tab             | every control stays in the tab order                                                                                               |
| Esc                        | one level up                                                                                                                       |
| Hover                      | highlight only; nothing is revealed or enabled by it                                                                               |

Every screen has one `h1`. Lists are real lists, choice rows are labelled radio groups, and the pause content keeps its dialog role and name.

## Role-ready

- Each catalogue entry carries a `role`: `driver` today. #443 adds `einweiser` entries, which may point at the same exercise definition; so the role lives on the menu's catalogue entry, not on `ExerciseDefinition`, and stored bests and replays are untouched.
- A role declares its setup steps. Driver has "conditions". Einweiser can add "where do you stand" without a new screen kind.
- A level with one choice is skipped: while only driver entries exist, Exercises shows them directly and no role is asked. Where the role choice sits once a second role has entries is for the Einweiser design; the list already takes the role as a parameter.

## Engine-neutral structure

- The screen graph (screens, items, targets, visibility conditions) is plain data in one module. Conditions and actions are named, not functions, so the graph is JSON-serialisable.
- Navigation is a pure function from stack and event to stack, with the focus memory inside the stack.
- The catalogue (entries with role, title, brief, steps) and the option fields (values, where they apply) are data too.
- The DOM layer is the only part that knows HTML: it renders a screen kind from that data and reports events.
- In UMG the mapping is one widget per screen kind, the graph and catalogue as data assets, message keys as a string table, the focus rules as the engine's focus navigation, and back as Esc, gamepad B and Android back. A native build adds a Quit item; the graph's visibility condition covers it.

## Data model (types only)

The types as built in `src/app/menu/{catalogue,graph,nav,options}.ts`. They are plain, engine-neutral data; `title`, `focus`, `list` and `groups` extend the first sketch. PR3's additions follow in their own block; PR4 to PR6 add nothing here.

```ts
// catalogue.ts
type Role = 'driver'; // 'einweiser' joins with #443
type EntryKind = 'exercise' | 'yard';

type EntryRef =
  | { role: Role; kind: 'exercise'; id: ExerciseId }
  | { role: Role; kind: 'yard'; id: LayoutId };

type SetupStepId = 'conditions'; // 'position' joins with #443
const SETUP_STEPS: Record<SetupStepId, readonly OptionId[]>;

type CatalogueEntry = {
  ref: EntryRef;
  title: MessageKey;
  brief: MessageKey;
  layout: LayoutId;
  steps: readonly SetupStepId[];
};

// graph.ts
type ScreenId =
  'title' | 'exercises' | 'yards' | 'setup' | 'settings' | 'controls' | 'whatsNew' | 'about';
type ScreenKind = 'menu' | 'entries' | 'setup' | 'options' | 'content';
type ActionId = 'replayLast';
type ConditionId = 'canReplay' | 'hasNews';

type Item = {
  id: string;
  label: MessageKey;
  tier: 'primary' | 'main' | 'secondary';
  target: { screen: ScreenId } | { action: ActionId };
  showWhen?: ConditionId;
  badgeWhen?: ConditionId;
};

type OptionGroup = { label: MessageKey; fields: readonly OptionId[] };

type Screen = {
  id: ScreenId;
  kind: ScreenKind;
  /** Null where the `h1` comes from the content (setup names its entry). */
  title: MessageKey | null;
  items: readonly Item[];
  /** Loaded on demand. */
  lazy: boolean;
  /** Item ids to focus on open, first shown wins. */
  focus?: readonly string[];
  list?: { role: Role; kind: EntryKind };
  groups?: readonly OptionGroup[];
};

/** A snapshot read by conditions, so the graph stays data. */
type MenuState = {
  done: readonly ExerciseId[];
  replayable: boolean;
  hasNews: boolean;
};

// options.ts
type OptionId =
  | 'truck'
  | 'trailer'
  | 'lighting'
  | 'driveView'
  | 'language'
  | 'theme'
  | 'graphics'
  | 'wideMirrors';

type Applies = 'live' | 'nextStart' | 'menuOnly' | 'run';

type Choice = {
  value: string;
  /** Vehicle names are data, not translated. */
  label: MessageKey | { text: string };
};

type OptionField = {
  id: OptionId;
  label: MessageKey;
  group: 'run' | 'general' | 'graphics';
  choices: readonly Choice[];
  applies: Applies;
};

// nav.ts
type Level = {
  screen: ScreenId;
  /** The entry being set up, and its step. */
  entry?: EntryRef;
  step?: number;
  /** The item or row to focus when this level is shown again. */
  focus: string | null;
};
type NavState = { stack: readonly Level[] }; // stack[0] is the title
type NavEvent =
  | { type: 'open'; item: string }
  | { type: 'pick'; entry: EntryRef }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'home' };
```

### Added in PR3

Task 3.2's interfaces, verbatim from the plan; Settings also gains `lastEntry: EntryRef | null` (Task 3.1).

**Interfaces:**
- Consumes: `continueEntry`, `lastEntryOf`, `entryOfRun` (Task 3.1); `runConfigOf`, `MenuState`, `holds` (Task 2.2); `MenuDeps.start` and the busy state (Tasks 2.4, 2.5); `seedStorage` (Task 2.4).
- Produces: `ActionId = 'replayLast' | 'continue'`, `ConditionId = 'canReplay' | 'hasNews' | 'canContinue'`, and `MenuState` gains `readonly lastEntry: EntryRef | null`.

## i18n

New keys. Call: the wording stands as listed ("Allgemein / General", "Starten", "Bedienung / Controls", "Über / About"); each new term gets a glossary row.

| Key                | English                     | German                     | Use                                            |
| ------------------ | --------------------------- | -------------------------- | ---------------------------------------------- |
| `start`            | Start                       | Starten                    | setup's primary action                         |
| `controls`         | Controls                    | Bedienung                  | title entry, Settings row, screen heading      |
| `about`            | About                       | Über                       | title entry, screen heading                    |
| `settingsGeneral`  | General                     | Allgemein                  | Settings group                                 |
| `settingsGraphics` | Graphics                    | Grafik                     | Settings group                                 |
| `appliesNextStart` | Applies from the next start | Gilt ab dem nächsten Start | hint under graphics quality in the pause sheet |
| `controlsKeyboard` | Keyboard                    | Tastatur                   | Controls group                                 |
| `controlsTouch`    | Touch and mouse             | Touch und Maus             | Controls group                                 |
| `aboutLicense`     | License                     | Lizenz                     | About                                          |
| `aboutThirdParty`  | Third-party licenses        | Lizenzen Dritter           | About                                          |
| `aboutAssets`      | Asset credits               | Quellen der Assets         | About                                          |
| `aboutSource`      | Source code                 | Quellcode                  | About                                          |

Also new: one key per touch-and-mouse row of the Controls screen (the builder writes them from `docs/usage.md`).

Reused as they are: `continue` (title), `settings`, `exercises`, `freeYard`, `whatsNew`, `whatsNewBadge`, `back`, `menu` (also the name of the title's navigation landmark), `replayLastRun`, `exerciseDone`, `tolerance`, the best and option keys, `estimateNote`, `keys` and the legend description keys.

Retired: `vehicleSetup`. A step heading returns when a second setup step exists.

## e2e impact

Most specs enter a drive by clicking an exercise card on the first page, and several change a setting through a dropdown. Both move.

### Shared helpers (new module beside `e2e/fixtures.ts`)

- `startExercise(page, messages, exercise)` and `startYard(page, messages, layout)`: walk title, list, setup and Start through the real menu, by role and name. They work under the pinned clock because swaps are synchronous.
- `chooseRunOption(page, messages, option, value)` on the setup screen and `chooseSetting(page, messages, option, value)` through Settings and back.
- `startPinnedDrive`, `e2e/perf/tablet-emulation.ts` and through them `scripts/shoot-views.mjs` use the same helpers.
- Each screen root carries `data-screen="<id>"`; items keep `data-menu` names. No test-only URL parameter or hook.

### Assertions that change

| Today                                                                                                        | Becomes                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `getByRole('button', { name: <exercise> }).click()` to start a drive (most specs, `startPinnedDrive`)        | `startExercise`                                                               |
| `[data-menu="yards"] .menu-start`, `START_BUTTON`, the yard button by name                                   | `startYard`                                                                   |
| `getByRole('combobox', { name: en.lighting \| en.driveView })`, `selectOption`, `toHaveValue`                | `chooseRunOption`; a radio in a named group, `toBeChecked`                    |
| `[data-menu="graphics" \| "wideMirrors" \| "language"]` with `selectOption`                                  | `chooseSetting`                                                               |
| Best lines read from the exercise card while switching time of day (`lighting-menu.spec`)                    | read from the setup screen                                                    |
| The replay label checked while the menu's time of day changes                                                | change it on a setup screen, go back to the title, check the label            |
| "the menu opens on the exercises" (`layout.spec`: card count, order before the vehicle fields, rows in view) | retired; replaced by the title fit and list checks below                      |
| "a double click on an exercise card leaves no text selected"                                                 | double click on Start; plus "a double click on a title entry moves one level" |
| "the back button leaves what's new for the menu" asserting an exercise card                                  | asserts the title's Exercises entry                                           |
| `.menu-scroll` in the overflow check of `whats-new.spec`                                                     | the screen's scroll container                                                 |

### Assertions that hold

- `getByRole('heading', { name: en.appName })` as "back at the menu": runs land on the title, which keeps that `h1`.
- `getByRole('button', { name: en.replayLastRun })`: presence, absence and label, on the title.
- `getByRole('button', { name: <whatsNew> })`, its focus on return, and the toast tests.
- `[data-menu="offline" | "build" | "channel"]`: on the title.
- Every pause, result and replay back sequence: the drive takes over the menu's entry as before.

### New checks

One menu spec, DOM only: it starts no drive, so it carries no `heavyAt` tag.

- The title does not scroll at 1280×585 in both languages: the one hard fit check. Lists, setup and settings may scroll inside the screen; for them the check is that Start and the last row can be reached. No screen overflows horizontally at 360 px; the list has one item per exercise in curriculum order.
- Continue's label shows each part: exercise, truck, trailer, time of day, driving view (stored settings seeded).
- The Continue rule from seeded bests: forward from the last driven exercise, wrapping, and the last driven one when all are done.
- Keyboard only: Enter alone walks from the title to Start; arrows move within a list; focus returns to the opener.
- Back: Esc and `goBack` step one level each from setup to the title; `goBack` on the title leaves; a reload on a sub-screen shows the title and the next `goBack` leaves.
- A held Enter does not run through several screens; a double click on a title entry moves one level.

Checks that need a drive join the specs that already own one, tagged as CLAUDE.md asks:

- `pause.spec`: a held Space from a drive does not start Continue; Settings opens inside the pause dialog, Esc returns to the actions and the next Esc resumes; Continue starts the stored entry; Esc and `goBack` between Start and the mounted drive change nothing.
- `layout.spec`: the wide-angle mirrors option in the pause sheet changes the running drive's layout.

Unit tests cover the pure parts only: the graph (every target exists, every screen is reachable from the title, it survives a JSON round trip), the navigation function, the Continue rule, and the new settings field.

## Delivery

Each PR goes `feature/*` → `develop`. Every user-visible one adds its changelog fragment and updates `docs/usage.md` and the glossary for what it changes.

1. **test: shared e2e start and option helpers.** Implemented against today's menu; every spec, `startPinnedDrive` and the tablet harness use them. No behaviour change, no fragment.
2. **feat: title screen with sub-screens.** Graph, navigation, history levels, focus and key rules including the held-key and double-click guards and the busy state on Start, the DOM layer; title, exercise list, yard list, run setup, Settings (General, Graphics); What's new and "Replay last run" re-homed; the menu spec; helpers switched to the new flow; the retired layout test removed. The largest PR: the screens cannot ship apart without a half-menu on `develop`.
3. **feat: Continue.** The stored last entry, the rule, the title block.
4. **feat: Controls screen.** Title entry and Settings row; the legend renderer moved to `src/input`.
5. **feat: About screen.** Licences and credits, loaded on demand, offline.
6. **feat: Settings in the pause sheet.** The nested dialog level, live wide-angle mirrors, the next-start hint.

3 to 6 are independent of each other and can run in parallel after 2.

## Left to the builder

- Visual design of every screen within the brand tokens, including the title illustration (static, theme-aware, inline SVG or CSS).
- Module layout under `src/app`, class names, and whether today's `menu.ts` is replaced or split.
- How the import constraint is guarded (a lint restriction on the menu modules is the obvious way).
- How a choice row wraps for long vehicle names and in portrait.
- The mechanism behind "a double click moves one level" and the held-key guard, shared with the result view.
- How About gets its texts offline: bundled into its chunk, or the licence files added to the precache; and a generated credits module with a staleness test like the Markdown has.
- Which runtime dependencies' licences About must list.
- How the drive reads the live wide-angle setting, and confirming that only `arrange()` depends on it.
- The CI slice table when the menu spec joins the suite.
- The final data types, written back into this document.

## Open for the owner

Nothing is open. Settled on 2026-11-25: Continue skips setup and shows the full setup; a static illustration, live 3D deferred; choice rows; "Menu" and Esc land on the title. Every "Call" above stands until the owner corrects it.

Follow-up, not in scope: exercise preview images drawn from the layout data.
