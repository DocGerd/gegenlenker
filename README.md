# Gegenlenker

A trainer for maneuvering a truck with a turntable drawbar trailer: reverse, steer against the trailer and dock it, in the browser and offline-capable.

Live: https://docgerd.github.io/gegenlenker/

## Develop

```sh
pnpm install
pnpm dev        # dev server; /?probe, ?perf=1
pnpm test       # unit tests
pnpm test:e2e   # Playwright offline check
pnpm test:perf  # headed, hardware GL, local only
pnpm build
```

## Vehicles and sources

- https://defence.mercedes-benz-trucks.com/fileadmin/Defence/Downloads/D_Technische-Daten_Arocs_ENG_screen.pdf
- https://mbpassion.de/2017/04/thw-uebernimmt-41-mercedes-benz-arocs-allradkipper/
- https://www.codeready.org/trucks/man-trucks/man-le-18-280-off-road-truck
- https://www.krone-trailer.com/fileadmin/media/downloads/DE/Wechselsysteme/Datenblaetter/Box_Carrier/AZW_18_eL3B9_DE.pdf
- https://www.thw-hamburg-nord.de/kfz/90793.htm

## Estimated parameters

The dimensions below are estimates, not manufacturer data, and the vehicle behaviour follows them.

<!-- prettier-ignore-start -->
<!-- estimates:start -->
| Vehicle | Parameter | Value | Basis |
| --- | --- | --- | --- |
| MAN LE 18.280 | wheelbase | 3900 mm | middle of three sourced wheelbase options |
| MAN LE 18.280 | frontOverhang | 1320 mm | derived from sourced chassis length |
| MAN LE 18.280 | frontTrack | 1950 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | rearTrack | 1800 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | couplingOffset | 1250 mm | frame end plus coupling crossmember, no source found |
| MAN LE 18.280 | eye.height | 1950 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | eye.behindBumper | 1000 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | eye.leftOfCentre | 400 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | mirror.lateral | 1250 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | mirror.glassOutboard | 200 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | mirror.behindBumper | 600 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | mirror.height | 2000 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | steering.lockToLockTurns | 5 turns | typical for the vehicle class, no source found |
| MAN LE 18.280 | steering.maxRate | 1.5 turns/s | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.windscreenInset | 149 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.glassSill | 900 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.glassHeight | 756 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.sideGlassSetback | 176 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.sideGlassLength | 814 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.grilleWidth | 1245 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.grilleSill | 144 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.grilleHeight | 540 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.headlampInset | 125 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.headlampWidth | 398 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.lampSill | 180 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | cab.lampHeight | 396 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | bumperInset | 100 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | tailLamp.inset | 100 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | tailLamp.width | 274 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | tailLamp.sill | 20 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | tailLamp.height | 160 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | mudflap.gap | 100 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | mudflap.clearance | 125 mm | typical for the vehicle class, no source found |
| MAN LE 18.280 | mudflap.height | 825 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | frontOverhang | 1450 mm | derived from sourced overall length |
| Mercedes-Benz Arocs 1835 AK | rearOverhang | 1435 mm | derived from sourced overall length |
| Mercedes-Benz Arocs 1835 AK | frontTrack | 2050 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | rearTrack | 1850 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | couplingOffset | 1500 mm | frame end plus coupling crossmember, no source found |
| Mercedes-Benz Arocs 1835 AK | eye.height | 2150 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | eye.behindBumper | 1300 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | eye.leftOfCentre | 500 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | mirror.lateral | 1400 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | mirror.glassOutboard | 200 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | mirror.behindBumper | 700 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | mirror.height | 2200 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | steering.lockToLockTurns | 5 turns | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | steering.maxRate | 1.5 turns/s | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.windscreenInset | 150 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.glassSill | 900 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.glassHeight | 756 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.sideGlassSetback | 176 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.sideGlassLength | 814 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.grilleWidth | 1250 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.grilleSill | 144 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.grilleHeight | 540 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.headlampInset | 125 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.headlampWidth | 400 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.lampSill | 180 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | cab.lampHeight | 396 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | bumperInset | 100 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | tailLamp.inset | 100 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | tailLamp.width | 275 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | tailLamp.sill | 20 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | tailLamp.height | 160 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | mudflap.gap | 100 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | mudflap.clearance | 125 mm | typical for the vehicle class, no source found |
| Mercedes-Benz Arocs 1835 AK | mudflap.height | 825 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | frontOverhang | 600 mm | fits a 7.45 m swap body |
| Krone AZW 18 | rearOverhang | 1675 mm | length to eye − drawbar − wheelbase |
| Krone AZW 18 | width | 2550 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | track | 2040 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | deckHeight | 1280 mm | midpoint of 1,190–1,370 frame height |
| Krone AZW 18 | couplingLimit | 80 ° | mechanical stop near 90°: drawbar meets frame or truck rear corner |
| Krone AZW 18 | turntableLimit | 85 ° | mechanical stop near 90°: drawbar meets frame or truck rear corner |
| Krone AZW 18 | underrunGuard.depth | 50 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | underrunGuard.inset | 100 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | underrunGuard.lowerEdge | 300 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | underrunGuard.height | 250 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | underrunGuard.strutOffset | 640 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | underrunGuard.strutWidth | 100 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | tailLamp.inset | 150 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | tailLamp.width | 360 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | tailLamp.sill | 100 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | tailLamp.height | 200 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | mudflap.gap | 100 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | mudflap.clearance | 125 mm | typical for the vehicle class, no source found |
| Krone AZW 18 | mudflap.height | 825 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | drawbar | 2600 mm | from comparable model HPA 20.67 LT |
| Hüffermann HPA 24.81 L | wheelbase | 5600 mm | from platform length and typical axle positions |
| Hüffermann HPA 24.81 L | rearAxleCount | 2 | inferred from 24 t gross weight and model family |
| Hüffermann HPA 24.81 L | rearAxleSpacing | 1310 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | frontOverhang | 900 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | rearOverhang | 2220 mm | fitted to sourced overall length |
| Hüffermann HPA 24.81 L | track | 2040 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | deckHeight | 700 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | couplingLimit | 80 ° | mechanical stop near 90°: drawbar meets frame or truck rear corner |
| Hüffermann HPA 24.81 L | turntableLimit | 85 ° | mechanical stop near 90°: drawbar meets frame or truck rear corner |
| Hüffermann HPA 24.81 L | underrunGuard.depth | 50 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | underrunGuard.inset | 100 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | underrunGuard.lowerEdge | 300 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | underrunGuard.height | 250 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | underrunGuard.strutOffset | 640 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | underrunGuard.strutWidth | 100 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | tailLamp.inset | 405 mm | on the loading ramps, no source found |
| Hüffermann HPA 24.81 L | tailLamp.width | 540 mm | on the loading ramps, no source found |
| Hüffermann HPA 24.81 L | tailLamp.sill | 100 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | tailLamp.height | 200 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | mudflap.gap | 100 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | mudflap.clearance | 125 mm | typical for the vehicle class, no source found |
| Hüffermann HPA 24.81 L | mudflap.height | 825 mm | typical for the vehicle class, no source found |
<!-- estimates:end -->
<!-- prettier-ignore-end -->

Measured values replace estimates in `src/vehicles/*.ts` without code changes.
The turning radius is taken at the outer front wheel centre.

## Licence

Apache-2.0. Geist is used under the SIL Open Font License.

© 2026 Patrick Kuhn
