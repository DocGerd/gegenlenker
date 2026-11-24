---
name: release
description: 'Cut, ship and back-merge a Gegenlenker release or hotfix end to end: /release [X.Y.Z] or /release hotfix. Stops for the owner to merge into main and to approve the github-pages deployment.'
argument-hint: '[X.Y.Z | hotfix]'
disable-model-invocation: true
---

# /release

Drives [docs/releasing.md](../../../docs/releasing.md) end to end; read it first, it owns the rules. Run the scripts from a clean worktree at a freshly fetched `origin/develop`: they act on `origin/*` and push by refspec, but run the working tree's code, and `main`'s copy lags until a release.

- `/release` or `/release X.Y.Z`: release. The first release has no earlier version to bump from: pass it (`/release 1.0.0`).
- `/release hotfix`: hotfix, see the end.

Agents run every step and merge the reviewed, green PRs, except into `main`: only the owner merges there (step 3.5). The owner also approves the `github-pages` deployment: never approve it and never touch `pending_deployments`.

Guard hook: keep each `git push` in its own command with an explicit refspec (`git push -u origin HEAD:refs/heads/<branch>`); pass `gh api` bodies with `--raw-field`/`-F`, never `-f`.

Work in a worktree per branch (`git worktree add ../gg-<slug> ...`, then `pnpm install --frozen-lockfile`); never switch branches in the main checkout. Set the repo-local `user.email` to the noreply address from CLAUDE.md in each.

## 1. Preflight

1. `git status --porcelain` is empty; `git fetch --tags origin`.
2. No open release: `git ls-remote --heads origin 'release/*'` lists nothing whose tip is not on `origin/main` (the cut refuses too).
3. `pnpm release:cut [X.Y.Z] --dry-run`. Show its output to the owner. A refusal is the answer, see Recovery; do not continue past one.

## 2. Cut and prepare

1. `pnpm release:cut [X.Y.Z]` (note the version it prints; use it from here on as `X.Y.Z`).
2. Freeze: from now `release/X.Y.Z` takes fixes by PR only, and a fix goes there only.
3. `git worktree add --no-track -b feature/prepare-X.Y.Z ../gg-prepare-X.Y.Z origin/release/X.Y.Z`; in it `pnpm release:prepare X.Y.Z` (folds fragments, sets `package.json`, regenerates `CHANGELOG.md`), commit, `pnpm check`, push the branch.
4. `gh pr create --base release/X.Y.Z --head feature/prepare-X.Y.Z --title "chore: prepare X.Y.Z" --body "Prepare X.Y.Z."`; independent review (see below); merge when `check` is green: `gh pr merge <n> --merge`.
5. Every fix that lands later and adds a fragment needs `release:prepare X.Y.Z` rerun the same way, or `release:check` fails on the `main` PR.

## 3. PR into main

1. Freeze rule: merge or close every open PR into `release/X.Y.Z` first (`gh pr list --base release/X.Y.Z`). Merging the release PR deletes the branch, and GitHub then [retargets](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-and-deleting-branches-within-your-repository) every PR still based on it to `main`, without a CI run.
2. `gh pr create --base main --head release/X.Y.Z --title "chore: release X.Y.Z" --body "Release X.Y.Z."`; no `Closes` line: the back-merge carries them.
3. Independent review of the PR diff: a reviewer other than the author reads it, posts one inline thread per finding, fixes land as PRs into `release/X.Y.Z`, every thread is resolved. The reviewer also checks the diff's changes to `.github/workflows/ci.yml` and the release scripts: the gate check below proves the steps ran, not that they still check anything.
4. Wait for the PR's CI run to finish, then run the gate check below. It refuses: stop.
5. Hand the owner `gh pr merge <n> --merge --match-head-commit <sha>`, with the `<sha>` the gate check verified, and wait for the merge; never run it yourself. Merge commit only; the ruleset rejects anything else. Out of date: `main` moves only by a hotfix, so finish its back-merge into `release/X.Y.Z` (Hotfix, step 4) and run the gate check on the new head; never `update-branch`, which merges `main` into the release branch outside a PR.
6. `gh pr list --base main --json number,headRefName --jq '.[] | select(.headRefName | test("^(release|hotfix)/") | not) | .number'` prints nothing: close each PR it prints, retargeted there.

### Gate check (before every merge into `main`)

The ruleset accepts a green `check` from any source, and a `develop` push or `workflow_dispatch` run of the same commit also reports one, with the guard skipped. Only the PR's own run proves the head-branch guard and `release:check` passed. Run each call in the foreground; any output other than the one expected refuses:

1. `gh api repos/DocGerd/gegenlenker/pulls/<n> --jq '[.state, .base.ref, .head.repo.full_name, .head.ref, .head.sha] | @tsv'` prints `open`, `main`, `DocGerd/gegenlenker`, `release/X.Y.Z` (or `hotfix/X.Y.Z`) and the head `<sha>`.
2. `gh api "repos/DocGerd/gegenlenker/actions/workflows/ci.yml/runs?event=pull_request&head_sha=<sha>" --jq '.workflow_runs | max_by(.run_number) | [.id, .status, .head_branch] | @tsv'` prints `<run-id>`, `completed` and the same head branch: the newest `pull_request` run of that commit.
3. `gh api "repos/DocGerd/gegenlenker/actions/runs/<run-id>/jobs?per_page=100" --jq '[(.jobs[] | select(.name == "lint") | .steps[] | select(.name == "Only release and hotfix branches open PRs into main" or .name == "Check the release tree") | .conclusion), (.jobs[] | select(.name == "check") | .conclusion)] | join(" ")'` prints exactly `success success success`: the guard and release-tree steps of `lint` in `.github/workflows/ci.yml`, then `check`. `skipped` means that run did not see base `main`: close and reopen the PR, then check again.

## 4. Stop for the owner

`gh api repos/DocGerd/gegenlenker/pulls/<n> --jq .merge_commit_sha` is the merge commit. After `git fetch origin`, `git rev-parse '<merge-sha>^{tree}' '<sha>^{tree}'` prints one tree twice (the merge ships the head that passed the gate check); if not, tell the owner not to approve, and stop. `gh run list --workflow ci.yml --event push --commit <merge-sha> --json databaseId,url,status` lists its run (wait until it appears). Tell the owner: approve the `github-pages` deployment of that run, with its URL, then wait. Do not approve it, and do not read or write `pending_deployments`.

Pending gated UAT deploys of `develop` (`deploy-uat-gated`) ahead of it in the `pages` queue are the owner's too: say so if the run waits (docs/releasing.md, UAT).

## 5. Wait and verify

1. Poll `gh run view <id> --json status,jobs --jq '.jobs[]|[.name,.status,.conclusion]'` until `deploy` and `release` both conclude `success`.
2. `git fetch --tags origin`; `git rev-parse 'vX.Y.Z^{commit}'` must equal the merge commit on `origin/main`.
3. `gh release view vX.Y.Z --json tagName,isDraft,url`: published (`isDraft` false). Report the URL.

## 6. Back-merge

1. `pnpm release:backmerge` (optionally `--dry-run` first); it opens `feature/back-merge-X.Y.Z` into `develop` (or the open `release/*` for a hotfix).
2. A pure merge needs no separate review: wait for a green `check`, then `gh pr merge <n> --merge`. Never squash or rebase. Once conflicts were resolved on it, it is no longer pure: independent review as in section 3 first.
3. `pnpm release:backmerge --verify` must print that `origin/main` is an ancestor of the target. Only then is the release done and the next `release:cut` possible.

## Hotfix (`/release hotfix`)

1. `pnpm hotfix:cut --dry-run`, show it, then `pnpm hotfix:cut` (version = next patch above `main`). Refuses before the first release, and when an open patch release would take the same version: then the fix goes into that release branch by PR.
2. `git fetch origin`, `git worktree add --track -b hotfix/X.Y.Z ../gg-hotfix-X.Y.Z origin/hotfix/X.Y.Z`; commit the fix, push the branch, and open its PR into `main` (title `fix: hotfix X.Y.Z`) so the fragment can link it. Then commit the fragment, `pnpm release:prepare X.Y.Z`, commit, `pnpm check`, push.
3. The independent review of section 3, wait for CI, the gate check, hand the owner the merge command (section 3, step 5), then sections 4 and 5. Skip the freeze rule.
4. `pnpm release:backmerge`: the target is the open `release/*` if any, else `develop`. Into a release branch, `released.json`, `CHANGELOG.md` and `package.json` conflict: keep the release version with its group above the hotfix group, then `pnpm changelog`. Then review, merge and `--verify` as in section 6.

## Recovery

- Any script refusal: the message names the cause and the fix; apply it, rerun the dry run. Typical: missing back-merge (run section 6 of the earlier release), another release open, dirty tree, `origin/<branch> differs from the remote` (run the `git fetch` it prints).
- Cut done but the release is abandoned: ask the owner; deleting `release/X.Y.Z` is theirs to approve, and `release:cut` refuses while it is open.
- `release:prepare` fails with `head group ... has no tag`: `git fetch --tags origin`, rerun; with `dirty`: commit or stash.
- `check` red on a PR into `release/X.Y.Z` or `main`: fix on a `feature/*` branch into the release branch (never directly; a hotfix takes it as a commit on `hotfix/X.Y.Z`), rerun prepare if a fragment changed, wait for green. A PR whose base changed starts no run: close and reopen it.
- `release:check` fails on the `main` PR (pending fragments, version mismatch): rerun `release:prepare X.Y.Z` on a fresh `feature/prepare-X.Y.Z` PR into the release branch.
- Merge refused: a ruleset (up to date, resolved threads, merge method) names the reason; resolve it, never bypass. If the harness denies `gh pr merge`, do not retry: hand the owner the exact command.
- Deploy waiting a long time: the owner has not approved, or gated UAT deploys are queued ahead; say so, do not touch deployments. Rejected: the owner's decision; stop and report. Cancelled or failed: `gh run rerun <id> --failed` (the owner approves again), else `gh workflow run ci.yml --ref main` redeploys production, and the release job follows the deploy.
- `release` job failed: `gh run rerun <id> --failed`; it is idempotent (a no-op once tagged and published). An `::error::` from it again (a tag on another commit, a draft or tagless release) is no transient failure: stop and report. Never delete or move a tag: releases are immutable, a wrong one burns its version.
- `release:backmerge` refuses `tag does not exist` or `no published GitHub Release`: the release job has not finished; wait and rerun. `branch feature/back-merge-X.Y.Z already exists` with no PR: ask the owner to delete it, rerun.
- Back-merge conflicts: in a worktree on `feature/back-merge-X.Y.Z`, `git merge origin/<target>`, resolve (docs/releasing.md, Back-merge: a fragment edited on `develop` after the cut becomes a `released.json` edit), commit, push the branch in its own command.
- `--verify` fails (squashed, rebased or missing): merge `origin/main` into the target through a PR with a merge commit, then verify again.
