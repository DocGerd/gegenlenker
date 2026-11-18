# Changelog fragments

A PR with a user-visible change adds one file here instead of editing `CHANGELOG.md`, so parallel PRs never conflict on `## [Unreleased]`. Docs, CI, chore and test-only PRs add none.

## Filename: `<number>.<category>.md`

- `<number>`: the PR (or issue) the entry is about. A second entry for the same number gets a suffix: `165-2.fixed.md`.
- `<category>`: lowercase Keep a Changelog 1.1 category: `added`, `changed`, `deprecated`, `removed`, `fixed`, `security`.

## Content

The entry text only: no leading `- `, no `### Category` heading. End it with the PR link, as `CHANGELOG.md` entries do. One file is one changelog line.

```
The result screen shows the delta to the previous best ([#84](https://github.com/DocGerd/gegenlenker/pull/84)).
```

`tools/changelog-fragments.test.ts` fails on a misnamed fragment, or one that is not a single bullet-free, heading-free line ending in its own PR link.

## Release

1. Rename `## [Unreleased]` to `## [X.Y.Z] - date`, keeping its bullets.
2. Add each fragment as a top-level bullet under its `### Category` heading.
3. Add a fresh empty `## [Unreleased]`.
4. Delete only the folded files, by name, never by glob.
5. Before tagging, confirm `changelog.d/` holds only `README.md`; a fragment merged after the fold is otherwise lost.
