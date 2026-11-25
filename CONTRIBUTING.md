# Contributing

Issues and pull requests are welcome; review capacity is limited. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

## Changes

- Changes go through pull requests into `develop`, the default branch; `develop`, `release/*` and `main` take no direct pushes. Name the branch `feature/<slug>` and reference the issue it resolves with `Closes #<n>`.
- `main` holds released versions only and accepts PRs from `release/*` and `hotfix/*` branches the owner cuts. Branch model, who merges what and the release steps: [docs/releasing.md](docs/releasing.md).
- Titles and commits use a conventional prefix: `feat`, `fix`, `docs`, `ci`, `chore`, `refactor`, `perf`, `test`.
- `pnpm install --frozen-lockfile`, then `pnpm verify` (lint, format, typecheck, unit and e2e tests) before opening a PR. `pnpm check` is the faster loop without e2e. Node and pnpm are pinned in `.nvmrc` and `package.json`.
- New functionality and bug fixes come with tests of their logic and critical paths; there is no coverage target (see "Tests" in [CLAUDE.md](CLAUDE.md)).
- A user-visible change adds a `changelog.d/<pr>.<category>.md` fragment ([format](changelog.d/README.md)); never edit `CHANGELOG.md`.
- UI text goes through `t()` and needs both `en` and `de`; German wording follows [docs/glossary.md](docs/glossary.md).
- CI must pass and review threads must be resolved before merge.

## Governance

- `DocGerd` is the sole maintainer and decides what is merged and released.
- The roadmap is the open [GitHub issues](https://github.com/DocGerd/gegenlenker/issues).
- Coding standards are the ESLint configuration (`pnpm lint`) and [CLAUDE.md](CLAUDE.md).
- New functionality and bug fixes require tests (see "Changes").

## Where to look

- [CLAUDE.md](CLAUDE.md): layering rules, units and signs, vehicle data, test conventions.
- [docs/](docs/): reference documentation.

## Licence

Contributions are submitted under the project [licence](LICENSE).
