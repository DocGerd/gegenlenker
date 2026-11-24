# Releasing

Reference for the gitflow release flow ([#366](https://github.com/DocGerd/gegenlenker/issues/366)). `main` holds only released, tagged, deployed versions; `develop` integrates; topic branches are `feature/*`; `release/*` and `hotfix/*` are reserved. Versions are SemVer, `package.json` is the single source, and the tag is `vX.Y.Z`.

Why: [ADR 0002](decisions/0002-gitflow-release-flow.md).

## Branches

| Branch          | Role                                                  | Cut from  | Merges into                                                         |
| --------------- | ----------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| `main`          | Released, tagged production code; merge commits only  | n/a       | n/a                                                                 |
| `develop`       | Integration; default branch and default PR base       | `main`    | n/a                                                                 |
| `feature/*`     | One change                                            | `develop` | `develop`                                                           |
| `release/X.Y.Z` | Stabilisation: fixes, changelog fold and version only | `develop` | `main`, then back-merged to `develop`                               |
| `hotfix/X.Y.Z`  | Urgent production fix                                 | `main`    | `main`, then back-merged to the open `release/*`, else to `develop` |

- A change lands on one of `develop`, an open `release/*` or a `hotfix/*`, and reaches the others only by back-merge.
- Merges into `main` and back-merges are merge commits, never squash or rebase.
- A PR closes its issues when it reaches `develop`, the default branch: closed means integrated, not released.

## Who does what

- The owner decides to release and merges into `main`. That merge is the only gate: no deployment needs approval, so production deploys, tags and publishes the release right after it.
- Agents cut `release/*` and `hotfix/*`, run `release:prepare` and `release:backmerge`, and merge reviewed PRs with green CI into `develop`, `release/*` and back-merges. They stop at a reviewed, gate-checked release or hotfix PR and hand the owner `gh pr merge <n> --merge --match-head-commit <sha>`; they never merge into `main` and never approve a deployment.
- `/release [X.Y.Z]` and `/release hotfix` (`.claude/skills/release/SKILL.md`) drive the whole procedure and stop for the owner's merge.
- Agents author as the owner's GitHub account, so no ruleset can tell them apart, and the `main` ruleset has no bypass list and no merger restriction. Only their instructions (CLAUDE.md, `/release`) keep agents out of `main`: no permission rule can tell a merge into `main` from one into `develop`, and GitHub cannot enforce it.

## CI

- PRs into `main` run the full gate, a guard that the head is a `release/*` or `hotfix/*` branch of this repository, and `release:check` (with the tags fetched). The guard catches mistakes only: a PR can edit it, and another run of the same commit also reports `check`. So `/release` hands the owner the merge into `main` only once its own run passed the guard and `release:check`; the owner's merge is the last gate.
- Changing a PR's base starts no run, and a re-run repeats the old one: after retargeting a PR, close and reopen it so CI checks it against the new base.
- Pushes to `develop` and `main` run the gate without e2e, then deploy, without approval.
- `main` builds and deploys production to the site root, then tags and publishes the release once the deploy succeeded. Its Pages artifact holds production alone, so a release needs nothing from `develop`, and `/uat/` is gone until the next `develop` deploy.
- `develop` deploys its UAT build to `/gegenlenker/uat/` (see UAT).
- `workflow_dispatch` of CI on `main` redeploys production; on `develop` it redeploys UAT.

## UAT

- Each `develop` deploy republishes production beside the UAT build: the production dist of the live `main` deploy, never rebuilt. `tools/uat-pages.ts` finds it from the last successful `deploy` job of a `push` or `workflow_dispatch` run on `main`, and fails closed unless that job's deployment succeeded, no newer production deployment did, the run holds exactly one unexpired `prod-dist-<sha>` uploaded before the job started, and the files match its manifest and commit exactly.
- `deploy-uat` (environment `uat-pages`, no reviewer) runs the lookup inside the `pages` group, right before uploading, so a release deployed while it waited is the one republished.
- It runs the script as `main` has it, never `develop`'s copy: `develop` supplies only the `uat-dist-<sha>` artifact of `build-uat`. The job itself comes from `develop`'s `ci.yml`, so a change to it takes effect on the next `develop` run, and PR review of `develop` is the boundary. While `main` has no `tools/uat-pages.ts`, every UAT deploy fails.
- Both deploy jobs share the `pages` concurrency group with `queue: max`: they run one at a time, and a newer deploy never replaces a waiting one (beyond the queue limit, it is cancelled).
- An expired `prod-dist-<sha>` fails the UAT deploy: run CI with `workflow_dispatch` on `main`, then on `develop`.
- After a UAT deploy the site root is unchanged (what `main` last deployed) and `/uat/` serves the `develop` commit with its UAT title.
- Roll back: `workflow_dispatch` of CI on `main` republishes production alone. To stop UAT deploys, remove the `develop` deployment branch policy of `uat-pages`.

## Commands

Run each on a clean tree; the scripts read `origin/*` and push by refspec, so the working tree and the checked-out branch stay as they are. Each refuses when `origin/main` or `origin/develop` differs from the remote (a fetch refspec that skips them). All three take `--dry-run`: it prints every `git` and `gh` step, runs the reads (including `git fetch`, which only updates remote-tracking refs and tags) and skips every write.

| Command                                     | Does                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm release:cut [X.Y.Z]`                  | Pushes `release/X.Y.Z` from `origin/develop`                                               |
| `pnpm hotfix:cut`                           | Pushes `hotfix/X.Y.Z` (the next patch above `main`) from `origin/main`                     |
| `pnpm release:backmerge [X.Y.Z] [--verify]` | Opens the back-merge PR after a release or hotfix is live; `--verify` checks it afterwards |

`release:cut` refuses when:

- `origin/main` is not an ancestor of `origin/develop` (a back-merge is missing);
- the tree is dirty;
- the version is not above `main`'s, or `release/X.Y.Z`, `hotfix/X.Y.Z` or tag `vX.Y.Z` exists;
- another `release/*` is open (its tip is not on `main`) or nothing is pending.

Without a version it derives one from `develop`'s pending entries the way `release:prepare` does (only `fixed` and `security` make a patch). The first release has no earlier version to bump from: pass it.

`hotfix:cut` refuses when `main`'s version has no tag (before the first release: put the fix into `develop` and cut the release), when `hotfix/X.Y.Z` or its tag exists, or when an open release is a patch release (same major and minor as `main`): it would take the same version, so the fix goes into that release branch by PR.

## Release

1. `pnpm release:cut`. Freeze: `release/X.Y.Z` takes only fixes, by PR, and a fix goes there only. `develop` stays open for the next version.
2. On a `feature/*` branch from `origin/release/X.Y.Z`, `pnpm release:prepare X.Y.Z`, and a PR into `release/X.Y.Z` (rerun it when a fix adds a fragment).
3. Merge or close every PR into `release/X.Y.Z` (merging deletes the branch, and GitHub retargets PRs still based on it to `main`), then PR `release/X.Y.Z` into `main`; CI runs the full gate and `release:check`. Once it is reviewed and green, the owner merges it with a merge commit.
4. The merge deploys production. After the deploy, the release job tags `vX.Y.Z` and publishes the GitHub Release.
5. `pnpm release:backmerge`, then merge the PR with a merge commit, then `pnpm release:backmerge --verify`.

## Hotfix

Rehearse with `pnpm hotfix:cut --dry-run` before the first real one.

1. `pnpm hotfix:cut`; commit the fix and its fragment on the branch; `pnpm release:prepare X.Y.Z`.
2. PR into `main`, then steps 3 and 4 of the release.
3. `pnpm release:backmerge`: the target is the open `release/*` if there is one, else `develop`. Into a release branch, `released.json`, `CHANGELOG.md` and `package.json` conflict: keep the release version with its group above the hotfix group, then regenerate `CHANGELOG.md` with `pnpm changelog`.

## Back-merge

- Refuses until tag `vX.Y.Z` is on `origin/main` and a published GitHub Release `vX.Y.Z` exists. The version defaults to `main`'s.
- Pushes `feature/back-merge-X.Y.Z` from `origin/main` (a dedicated head: the release branch is deleted on merge) and opens the PR with `gh pr create`.
- The PR body carries a `Closes #n` line for every issue closed by the merged PRs into or from `release/X.Y.Z` and `hotfix/X.Y.Z`, for each version tagged on `main` that the target lacks: closing keywords act only on PRs into the default branch, so the issues close when the back-merge reaches `develop`.
- Merge with a merge commit, never squash or rebase. Conflicts in `released.json`, `CHANGELOG.md` or `package.json`: merge the target into the back-merge branch locally and resolve there. A fragment edited on `develop` after the cut gives a modify/delete conflict: move the edit into `released.json`.
- `--verify` fetches and checks `git merge-base --is-ancestor origin/main <target>`, against the open release in the hotfix case. A squashed or rebased back-merge fails it, and `release:cut` refuses until it passes.

## Before the first release

There is no version to patch, so `hotfix:cut` refuses: an urgent fix goes into `develop` and the first release is cut straight away with its version passed explicitly (`pnpm release:cut 1.0.0`).
