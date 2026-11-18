import type { GraphicsPreset, SceneRenderer } from '../contracts/render';
import { proceduralAids } from './aids';
import { proceduralEnvironment } from './environment';
import { startCabShells } from './cab-shell';
import { QUALITY_FLAGS } from './quality';
import { createThreeSceneRenderer } from './three-renderer';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

/** Whether the preset offers the outside view. */
export const chaseViewAvailable = (preset: GraphicsPreset): boolean =>
  QUALITY_FLAGS[preset].chaseView;

export function createSceneRenderer(): SceneRenderer {
  // Positive signal for the offline e2e: set once a shell has replaced a truck's procedural cab.
  // Loads wait for the first preset that wants the glb.
  const shells = startCabShells(
    undefined,
    (id) => {
      document.documentElement.dataset['cabShell'] = id;
    },
    false,
  );
  const renderer = createThreeSceneRenderer({
    truck: (spec, palette) => proceduralTruck(spec, palette, shells),
    trailer: proceduralTrailer,
    environment: proceduralEnvironment,
    aids: proceduralAids,
  });
  return {
    ...renderer,
    setQuality(preset) {
      shells.setEnabled(QUALITY_FLAGS[preset].cabGlb);
      renderer.setQuality(preset);
    },
  };
}
