# Changelog fragments

A PR with a user-visible change adds one file here instead of editing `CHANGELOG.md`, so parallel PRs never conflict. Docs, CI, chore and test-only PRs add none.

`CHANGELOG.md` is generated: `pnpm changelog` builds it from `released.json` only; pending fragments are not in it (they show in the app's "What's new" and enter `released.json` at release), so a fragment PR never touches `CHANGELOG.md`. Never edit it by hand; `tools/changelog.test.ts` fails when it is stale, so run `pnpm changelog` after every change to `released.json`.

## Filename: `<number>.<category>.md`

- `<number>`: the PR (or issue) the entry is about. A second entry for the same number gets a suffix: `165-2.fixed.md`.
- `<category>`: lowercase Keep a Changelog 1.1 category: `added`, `changed`, `deprecated`, `removed`, `fixed`, `security`.

## Content: one English line

The entry text only: no leading `- `, no `### Category` heading. End it with the PR link, as `CHANGELOG.md` entries do. One file is one changelog line.

```
The result screen shows the delta to the previous best ([#84](https://github.com/DocGerd/gegenlenker/pull/84)).
```

- Describe the effect for the trainee, not the mechanism: no renderer, URL parameter, fingerprint or code names.
- A full sentence ending in a period, plain text with optional `inline code`: no list marker, heading, emphasis, HTML, backslash, entity or other links.
- The app shows these lines in its "What's new" screen. The changelog is English only.

`tools/changelog-fragments.test.ts` fails on a fragment that breaks any of this.

## `released.json`

An array of releases, newest first. The unreleased group (`"version": null`, no date) comes first and holds the migrated history; a released group has `"version": "X.Y.Z"` and a `"date": "YYYY-MM-DD"`. An entry is `{ "id", "category", "prs", "en" }`: `id` is unique across the file and the fragments (a folded fragment keeps its file name without `.md`), `prs` lists every PR number, and `en` is the line without the link group, ending in a period. `tools/changelog.test.ts` checks the schema.

## Release

1. In `released.json`, give the unreleased group its `"version"` and `"date"`; if there is none, add a new first group with them.
2. Add each fragment to that group as an entry, in PR number order, with `id` the file name without `.md`, `prs` the PR number, and `en` the line without the link group (ending in a period).
3. Delete only the folded files, by name, never by glob.
4. Run `pnpm changelog`; the folded entries appear in `CHANGELOG.md`, in their own `## [X.Y.Z] - date` section.
5. Before tagging, confirm `changelog.d/` holds only `README.md` and `released.json`; a fragment merged after the fold is otherwise lost.
