---
name: release
description: "Cut, ship and back-merge a Gegenlenker release or hotfix end to end: /release [X.Y.Z] or /release hotfix. Stops once for the owner to approve the github-pages deployment."
argument-hint: "[X.Y.Z | hotfix]"
disable-model-invocation: true
---

# /release

Drives [docs/releasing.md](../../../docs/releasing.md) end to end; read it first, it owns the rules. Run from a clean checkout of this repository (commands read `origin/*` and push by refspec, so the checked-out branch does not matter).

- `/release` or `/release X.Y.Z`: release. The first release has no earlier version to bump from: pass it (`/release 1.0.0`).
- `/release hotfix`: hotfix, see the end.

Agents run every step and merge the reviewed, green PRs, including into `main`. The owner only approves the `github-pages` deployment: never approve it and never touch `pending_deployments`.

Guard hook: keep each `git push` in its own command with an explicit refspec (`git push -u origin HEAD:refs/heads/<branch>`); pass `gh api` bodies with `--raw-field`/`-F`, never `-f`.

Work in a worktree per branch (`git worktree add ../gg-<slug> ...`, then `pnpm install --frozen-lockfile`); never switch branches in the main checkout. Set the repo-local `user.email` to the noreply address from CLAUDE.md in each.

## 1. Preflight

1. `git status --porcelain` is empty; `git fetch --tags origin`.
2. No open release: `git ls-remote --heads origin 'release/*'` lists nothing whose tip is not on `origin/main` (the cut refuses too).
3. `pnpm release:cut [X.Y.Z] --dry-run`. Show its output to the owner. A refusal is the answer, see Recovery; do not continue past one.

## 2. Cut and prepare

1. `pnpm release:cut [X.Y.Z]` (note the version it prints; use it from here on as `X.Y.Z`).
2. Freeze: from now `release/X.Y.Z` takes fixes by PR only, and a fix goes there only.
3. `git worktree add ../gg-prepare-X.Y.Z -b feature/prepare-X.Y.Z origin/release/X.Y.Z`; in it `pnpm release:prepare X.Y.Z` (folds fragments, sets `package.json`, regenerates `CHANGELOG.md`), commit, `pnpm check`, push the branch.
4. `gh pr create --base release/X.Y.Z` titled `chore: prepare X.Y.Z`; independent review (see below); merge when `check` is green: `gh pr merge <n> --merge`.
5. Every fix that lands later and adds a fragment needs `release:prepare X.Y.Z` rerun the same way, or `release:check` fails on the `main` PR.

## 3. PR into main

1. Freeze rule: merge or close every open PR into `release/X.Y.Z` first (`gh pr list --base release/X.Y.Z`). The branch is deleted when its PR merges, which would close a PR still targeting it.
2. `gh pr create --base main --head release/X.Y.Z --title "chore: release X.Y.Z"`; no `Closes` line: the back-merge carries them.
3. Independent review of the PR diff: a reviewer other than the author reads it, posts one inline thread per finding, fixes land as PRs into `release/X.Y.Z`, every thread is resolved.
4. Wait for a green `check`: it runs the full gate, the head-branch guard and `release:check`. Poll the check-run on the head SHA, e.g. `gh api repos/DocGerd/gegenlenker/commits/<sha>/check-runs --jq '.check_runs[]|select(.name=="check")|.conclusion'` (foreground-test it once before looping).
5. `gh pr merge <n> --merge`. Merge commit only; the ruleset rejects anything else. If the merge is refused as out of date: `gh api -X PUT repos/DocGerd/gegenlenker/pulls/<n>/update-branch`, wait for CI again.

## 4. Stop for the owner

`gh run list --workflow ci.yml --branch main --event push --limit 1 --json databaseId,url,headSha,status` (headSha is the merge commit). Tell the owner: approve the `github-pages` deployment of that run, with its URL, then wait. Do not approve it, and do not read or write `pending_deployments`.

Pending UAT deploys of `develop` ahead of it in the `pages` queue are the owner's too: say so if the run waits (docs/releasing.md, UAT).

## 5. Wait and verify

1. Poll `gh run view <id> --json status,jobs --jq '.jobs[]|[.name,.status,.conclusion]'` until `deploy` and `release` both conclude `success`.
2. `git fetch --tags origin`; `git rev-parse 'vX.Y.Z^{commit}'` must equal the merge commit on `origin/main`.
3. `gh release view vX.Y.Z --json tagName,isDraft,url`: published (`isDraft` false). Report the URL.

## 6. Back-merge

1. `pnpm release:backmerge` (optionally `--dry-run` first); it opens `feature/back-merge-X.Y.Z` into `develop` (or the open `release/*` for a hotfix).
2. A pure merge needs no separate review: wait for a green `check`, then `gh pr merge <n> --merge`. Never squash or rebase.
3. `pnpm release:backmerge --verify` must print that `origin/main` is an ancestor of the target. Only then is the release done and the next `release:cut` possible.

## Hotfix (`/release hotfix`)

1. `pnpm hotfix:cut --dry-run`, show it, then `pnpm hotfix:cut` (version = next patch above `main`). Refuses before the first release, and when an open patch release would take the same version: then the fix goes into that release branch by PR.
2. `git fetch origin`, `git worktree add --track -b hotfix/X.Y.Z ../gg-hotfix-X.Y.Z origin/hotfix/X.Y.Z`; commit the fix and its fragment, `pnpm release:prepare X.Y.Z`, `pnpm check`, push the branch.
3. PR `hotfix/X.Y.Z` into `main` (title `fix: hotfix X.Y.Z`) with the independent review of section 3, wait for `check`, merge, then sections 4 and 5. Skip the freeze rule.
4. `pnpm release:backmerge`: the target is the open `release/*` if any, else `develop`. Into a release branch, `released.json`, `CHANGELOG.md` and `package.json` conflict: keep the release version with its group above the hotfix group, then `pnpm changelog`. Then merge and `--verify` as in section 6.

## Recovery

- Any script refusal: the message names the cause and the fix; apply it, rerun the dry run. Typical: missing back-merge (run section 6 of the earlier release), another release open, dirty tree, `origin/<branch> differs from the remote` (run the `git fetch` it prints).
- Cut done but the release is abandoned: ask the owner; deleting `release/X.Y.Z` is theirs to approve, and `release:cut` refuses while it is open.
- `release:prepare` fails with `head group ... has no tag`: `git fetch --tags origin`, rerun; with `dirty`: commit or stash.
- `check` red on a PR into `release/X.Y.Z` or `main`: fix on a `feature/*` branch into the release branch (never directly), rerun prepare if a fragment changed, wait for green. A PR whose base changed starts no run: close and reopen it.
- `release:check` fails on the `main` PR (pending fragments, version mismatch): rerun `release:prepare X.Y.Z` on a fresh `feature/prepare-X.Y.Z` PR into the release branch.
- Merge refused: a ruleset (up to date, resolved threads, merge method) names the reason; resolve it, never bypass. If the harness denies `gh pr merge`, do not retry: hand the owner the exact command.
- Deploy waiting a long time: the owner has not approved, or UAT deploys are queued ahead; say so, do not touch deployments. Deploy rejected, cancelled or failed: `gh run rerun <id> --failed` (the owner approves again), else `gh workflow run ci.yml --ref main` redeploys production, and the release job follows the deploy.
- `release` job failed: `gh run rerun <id> --failed`; it is idempotent (a no-op once tagged and published). Never delete or move a tag: releases are immutable, a wrong one burns its version, so stop and report.
- `release:backmerge` refuses `tag does not exist` or `no published GitHub Release`: the release job has not finished; wait and rerun. `branch feature/back-merge-X.Y.Z already exists` with no PR: ask the owner to delete it, rerun.
- Back-merge conflicts: in a worktree on `feature/back-merge-X.Y.Z`, `git merge origin/<target>`, resolve (docs/releasing.md, Back-merge: a fragment edited on `develop` after the cut becomes a `released.json` edit), commit, push the branch in its own command.
- `--verify` fails (squashed, rebased or missing): merge `origin/main` into the target through a PR with a merge commit, then verify again.
