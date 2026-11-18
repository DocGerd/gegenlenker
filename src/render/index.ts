import type { GraphicsPreset, SceneRenderer } from '../contracts/render';
import { proceduralAids } from './aids';
import { proceduralEnvironment } from './environment';
import { BODY_SHELL_URLS, CAB_SHELL_URLS, startShells } from './glb-shells';
import { QUALITY_FLAGS } from './quality';
import { createThreeSceneRenderer } from './three-renderer';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

/** Whether the preset offers the outside view. */
export const chaseViewAvailable = (preset: GraphicsPreset): boolean =>
  QUALITY_FLAGS[preset].chaseView;

export function createSceneRenderer(): SceneRenderer {
  // Positive signal for the offline e2e: the shells that have replaced procedural meshes, sorted
  // and space-separated. Each group loads on the first preset that wants it.
  const applied = new Set<string>();
  const onApplied = (key: string): void => {
    applied.add(key);
    document.documentElement.dataset['vehicleShells'] = [...applied].sort().join(' ');
  };
  const shells = {
    cab: startShells(CAB_SHELL_URLS, { onApplied, enabled: false }),
    body: startShells(BODY_SHELL_URLS, { onApplied, enabled: false }),
  };
  const renderer = createThreeSceneRenderer({
    truck: (spec, palette) => proceduralTruck(spec, palette, shells),
    trailer: proceduralTrailer,
    environment: proceduralEnvironment,
    aids: proceduralAids,
  });
  return {
    ...renderer,
    setQuality(preset) {
      const flags = QUALITY_FLAGS[preset];
      shells.cab.setEnabled(flags.cabGlb);
      shells.body.setEnabled(flags.vehicleGlb);
      renderer.setQuality(preset);
    },
  };
}
