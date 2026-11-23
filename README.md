# Gegenlenker

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/DocGerd/gegenlenker/badge)](https://scorecard.dev/viewer/?uri=github.com/DocGerd/gegenlenker)

A trainer for maneuvering a truck with a turntable drawbar trailer: reverse, steer against the trailer and dock it, in the browser and offline-capable.

Live, the latest release: https://docgerd.github.io/gegenlenker/ ([releases](https://github.com/DocGerd/gegenlenker/releases))

## Quickstart

Requires Node and pnpm as pinned in `.nvmrc` and `package.json`.

```sh
pnpm install
pnpm dev        # dev server
pnpm test       # unit tests
pnpm test:e2e   # Playwright offline check
pnpm test:perf  # headed, hardware GL, local only
pnpm perf:tablet  # emulated tablet on the real GPU, local only (docs/perf.md)
pnpm build
pnpm verify     # lint, format, typecheck, unit and e2e tests
```

## Layout

- `src/`: the app
- `docs/`: reference documentation

## Documentation

- [User guide](docs/usage.md): controls, views, exercises, settings, URL parameters, browser storage
- [Vehicle data](docs/vehicle-data.md): sources and the generated table of estimated parameters
- [Brand](docs/brand/BRAND.md)
- [Wording glossary](docs/glossary.md)
- [Engine choice ADR](docs/decisions/0001-engine-choice.md); [gitflow ADR](docs/decisions/0002-gitflow-release-flow.md)
- [Release flow](docs/releasing.md): branches, who merges what, releases and hotfixes
- [Asset credits](docs/asset-credits.md): source and licence of each third-party asset
- [Changelog](CHANGELOG.md); [changelog fragments](changelog.d/README.md)
- [Contributing](CONTRIBUTING.md); [code of conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)

## Licence

Apache-2.0. Geist is used under the SIL Open Font License (`public/licenses/geist-OFL.txt`); the Basis Universal transcoder shipped with the ground texture is Apache-2.0 (`public/licenses/basis-universal-Apache-2.0.txt`).

© 2026 Patrick Kuhn
