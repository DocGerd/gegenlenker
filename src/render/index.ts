import type { SceneRenderer } from '../contracts/render';
import { proceduralAids } from './aids';
import { proceduralEnvironment } from './environment';
import { createThreeSceneRenderer } from './three-renderer';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

export function createSceneRenderer(): SceneRenderer {
  return createThreeSceneRenderer({
    truck: proceduralTruck,
    trailer: proceduralTrailer,
    environment: proceduralEnvironment,
    aids: proceduralAids,
  });
}
