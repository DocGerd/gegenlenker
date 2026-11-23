# Releasing

Reference for the gitflow release flow ([#366](https://github.com/DocGerd/gegenlenker/issues/366)). `main` holds only released, tagged, deployed versions; `develop` integrates; topic branches are `feature/*`; `release/*` and `hotfix/*` are reserved. Versions are SemVer, `package.json` is the single source, and the tag is `vX.Y.Z`.

Only the owner cuts releases and hotfixes and merges into `main`. Agents merge reviewed, green PRs into `develop` and `release/*`, and back-merges.

## Commands

Run each on a clean tree; the scripts read `origin/*` and push by refspec, so the working tree and the checked-out branch stay as they are. All three take `--dry-run`: it prints every `git` and `gh` step, runs the reads (including `git fetch`, which only updates remote-tracking refs and tags) and skips every write.

| Command                                     | Does                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm release:cut [X.Y.Z]`                  | Pushes `release/X.Y.Z` from `origin/develop`                                               |
| `pnpm hotfix:cut`                           | Pushes `hotfix/X.Y.Z` (the next patch above `main`) from `origin/main`                     |
| `pnpm release:backmerge [X.Y.Z] [--verify]` | Opens the back-merge PR after a release or hotfix is live; `--verify` checks it afterwards |

`release:cut` refuses when:

- `origin/main` is not an ancestor of `origin/develop` (a back-merge is missing);
- the tree is dirty;
- the version is not above `main`'s, or `release/X.Y.Z` or tag `vX.Y.Z` exists;
- another `release/*` is open (its tip is not on `main`) or nothing is pending.

Without a version it derives one from `develop`'s pending entries the way `release:prepare` does (only `fixed` and `security` make a patch). The first release has no earlier version to bump from: pass it.

`hotfix:cut` refuses when `main`'s version has no tag (before the first release: put the fix into `develop` and cut the release), when `hotfix/X.Y.Z` or its tag exists, or when an open release is a patch release (same major and minor as `main`): it would take the same version, so the fix goes into that release branch by PR.

## Release

1. `pnpm release:cut`. Freeze: `release/X.Y.Z` takes only fixes, by PR, and a fix goes there only. `develop` stays open for the next version.
2. On the release branch, `pnpm release:prepare X.Y.Z`, and a PR into `release/X.Y.Z` (rerun it when a fix adds a fragment).
3. PR `release/X.Y.Z` into `main`; CI runs the full gate and `release:check`. The owner merges it with a merge commit.
4. The owner approves the `github-pages` deployment. After the deploy, the release job tags `vX.Y.Z` and publishes the GitHub Release.
5. `pnpm release:backmerge`, then merge the PR with a merge commit, then `pnpm release:backmerge --verify`.

## Hotfix

Rehearse with `pnpm hotfix:cut --dry-run` before the first real one.

1. `pnpm hotfix:cut`; commit the fix and its fragment on the branch; `pnpm release:prepare X.Y.Z`.
2. PR into `main`, then steps 3 and 4 of the release.
3. `pnpm release:backmerge`: the target is the open `release/*` if there is one, else `develop`. Into a release branch, `released.json`, `CHANGELOG.md` and `package.json` conflict: keep the release version with its group above the hotfix group, then regenerate `CHANGELOG.md` with `pnpm changelog`.

## Back-merge

- Refuses until tag `vX.Y.Z` is on `origin/main` and a published GitHub Release `vX.Y.Z` exists. The version defaults to `main`'s.
- Pushes `feature/back-merge-X.Y.Z` from `origin/main` (a dedicated head: the release branch is deleted on merge) and opens the PR with `gh pr create`.
- The PR body carries a `Closes #n` line for every issue closed by the PRs merged into `release/X.Y.Z` and the PRs from `release/X.Y.Z` or `hotfix/X.Y.Z` into `main`: closing keywords act only on PRs into the default branch, so the issues close when the back-merge reaches `develop`.
- Merge with a merge commit, never squash or rebase. Conflicts in `released.json`, `CHANGELOG.md` or `package.json`: merge the target into the back-merge branch locally and resolve there. A fragment edited on `develop` after the cut gives a modify/delete conflict: move the edit into `released.json`.
- `--verify` fetches and checks `git merge-base --is-ancestor origin/main <target>`, against the open release in the hotfix case. A squashed or rebased back-merge fails it, and `release:cut` refuses until it passes.

## Before the first release

There is no version to patch, so `hotfix:cut` refuses: an urgent fix goes into `develop` and the first release is cut straight away with its version passed explicitly (`pnpm release:cut 1.0.0`).
