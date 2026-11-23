# 0002: Gitflow and release flow

- Status: accepted
- Date: 2026-11-23
- Issue: #366

## Context

Until the cutover `main` was the only long-lived branch: every merge deployed, nothing was versioned or tagged, and an installed app saw an update prompt per merge. The owner asked for gitflow with release flows.

## Options

1. **GitHub flow** (before): simplest; every merge is live; no versions, no gate between merged and live.
2. **Trunk + release tags**: `main` stays the integration branch and production deploys only from a `v*` tag. Same gate, versions and batched update prompts with one branch and no back-merges. This is the common practice for a continuously deployed web app; gitflow's author advises a simpler workflow for those.
3. **Gitflow**: `main` equals production, a stabilisation branch keeps `develop` moving during a freeze, an explicit hotfix path, an owner gate at `main`. Costs a second long-lived branch, back-merges and their failure modes, and CI runs again for each release and back-merge PR.

## Decision

Gitflow, as requested. Branches and commands are in [releasing.md](../releasing.md).

- Default branch and PR base: `develop`. Closing keywords act only on PRs into the default branch, so an issue closes when it reaches `develop` (integrated, not released); `release:backmerge` copies the `Closes` lines of release and hotfix PRs into the back-merge.
- Topic branches are `feature/*`; `release/` and `hotfix/` are reserved. Titles and commits keep the conventional prefixes.
- Merge authority: agents merge reviewed, green PRs into `develop` and `release/*`, and back-merges. Only the owner cuts releases and hotfixes and merges into `main`. Agents act under the owner's token, so review approvals cannot enforce this; the `github-pages` environment requires owner approval with admin bypass off, adding a deliberate step before anything goes live.
- `main` accepts merge commits only; PRs into it come from `release/*` or `hotfix/*` heads, which CI checks and `release:check` gates. The check catches mistakes only, since no ruleset rule restricts a head branch.
- SemVer in `package.json` (single source), tag `vX.Y.Z` on the merge commit, one GitHub Release per version with that version's changelog section. A workflow job tags only after the deploy succeeded; releases are immutable, so a wrong release burns its version and `release:check` must pass first. The first version is `1.0.0`.
- Production deploys from `main` only. `develop` deploys to a UAT subpath of the same Pages site: one artifact holds both, and a `develop` run reuses the cached, byte-verified production `dist` instead of rebuilding it. The subpath shares the production origin, so the service worker excludes it and storage and cache names are split per build channel. Each UAT deploy waits for owner approval. A `main` deploy publishes production alone, so a release needs nothing from `develop`; `/uat/` returns with the next `develop` deploy. The UAT jobs that verify and publish run `main`'s code, never `develop`'s, so only a release can change what checks the site root. This reverses the draft's ruling-out of a subpath, which named exactly these gaps.
- Dependabot keeps targeting the default branch with no `target-branch`, and Scorecard's `push` trigger moves to `develop`: both describe `develop`, not production. A security fix production needs before the next release ships as a hotfix.

## Consequences

- Merged is not live: a change reaches production with the next release, and one update prompt replaces one per merge.
- Every release needs a back-merge; a skipped one blocks the next `release:cut`.
- CI runs on pushes to `develop` as well as `main` (the gate without e2e). `develop` is the default branch, so every PR can restore the pnpm and Playwright caches those pushes save.
- The owner approves every deploy, including UAT.

## Revisit triggers

- Release overhead outweighs the stabilisation branch: fall back to trunk + release tags (one branch, deploy from the tag).
- A separate agent identity makes the merge-authority rule enforceable.
