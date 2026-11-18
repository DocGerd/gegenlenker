# Gegenlenker

A trainer for maneuvering a truck with a turntable drawbar trailer: reverse, steer against the trailer and dock it, in the browser and offline-capable.

Live: https://docgerd.github.io/gegenlenker/

## Quickstart

Requires Node and pnpm as pinned in `.nvmrc` and `package.json`.

```sh
pnpm install
pnpm dev        # dev server
pnpm test       # unit tests
pnpm test:e2e   # Playwright offline check
pnpm test:perf  # headed, hardware GL, local only
pnpm build
pnpm verify     # lint, format, typecheck, unit and e2e tests
```

## Layout

- `src/`: the app
- `docs/`: reference documentation

## Documentation

- [Vehicle data](docs/vehicle-data.md): sources and the generated table of estimated parameters
- [Brand](docs/brand/BRAND.md)
- [Wording glossary](docs/glossary.md)
- [Engine choice ADR](docs/decisions/0001-engine-choice.md)
- [Changelog](CHANGELOG.md); [changelog fragments](changelog.d/README.md)
- [Security policy](SECURITY.md)

## Licence

Apache-2.0. Geist is used under the SIL Open Font License (`public/licenses/geist-OFL.txt`); the Basis Universal transcoder shipped with the ground texture is Apache-2.0 (`public/licenses/basis-universal-Apache-2.0.txt`).

© 2026 Patrick Kuhn
