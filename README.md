# Gegenlenker

A trainer for maneuvering a truck with a turntable drawbar trailer: reverse, steer against the trailer and dock it, in the browser and offline-capable.

Live: https://docgerd.github.io/gegenlenker/

## Quickstart

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm dev        # dev server; /?probe, ?perf=1
pnpm test       # unit tests
pnpm test:e2e   # Playwright offline check
pnpm test:perf  # headed, hardware GL, local only
pnpm build
pnpm verify     # lint, format, typecheck, unit and e2e tests
```

## Layout

- `src/`: the app (simulation, vehicles, rendering, HUD, input, i18n, PWA)
- `dev/`: standalone harness pages
- `e2e/`: Playwright specs
- `scripts/`, `tools/`: generators and tooling, including the Blender cab source
- `docs/`: reference documentation

## Documentation

- [Vehicle data](docs/vehicle-data.md): sources and the generated table of estimated parameters
- [Brand](docs/brand/BRAND.md)
- [Wording glossary](docs/glossary.md)
- [Changelog](CHANGELOG.md); [changelog fragments](changelog.d/README.md)
- [Security policy](SECURITY.md)

## Licence

Apache-2.0. Geist is used under the SIL Open Font License (`public/licenses/geist-OFL.txt`); the Basis Universal transcoder shipped with the ground texture is Apache-2.0 (`public/licenses/basis-universal-Apache-2.0.txt`).

© 2026 Patrick Kuhn
