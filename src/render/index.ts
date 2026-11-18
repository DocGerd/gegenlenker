import type { SceneRenderer } from '../contracts/render';
import { proceduralAids } from './aids';
import { proceduralEnvironment } from './environment';
import { startCabShells } from './cab-shell';
import { createThreeSceneRenderer } from './three-renderer';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

export function createSceneRenderer(): SceneRenderer {
  // Positive signal for the offline e2e: set once a shell has replaced a truck's procedural cab.
  const shells = startCabShells(undefined, (id) => {
    document.documentElement.dataset['cabShell'] = id;
  });
  return createThreeSceneRenderer({
    truck: (spec, palette) => proceduralTruck(spec, palette, shells),
    trailer: proceduralTrailer,
    environment: proceduralEnvironment,
    aids: proceduralAids,
  });
}
