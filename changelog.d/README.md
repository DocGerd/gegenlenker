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

`tools/changelog-fragments.test.ts` fails on a misnamed fragment or one that opens with a heading.

## Release

At the release cut, fold each fragment into the new `## [X.Y.Z] - date` section of `CHANGELOG.md` under its `### Category` heading as a top-level bullet, then delete the fragment files. Check this directory again right before tagging: a fragment merged after the fold is otherwise lost.
