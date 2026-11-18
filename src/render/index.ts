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
  // Positive signal for the offline e2e: the shells now attached to a vehicle, sorted and
  // space-separated; absent when none is. Each group loads on the first preset that wants it.
  const attached = new Set<string>();
  const onAttached = (key: string, on: boolean): void => {
    if (on) attached.add(key);
    else attached.delete(key);
    const { dataset } = document.documentElement;
    if (attached.size > 0) dataset['vehicleShells'] = [...attached].sort().join(' ');
    else delete dataset['vehicleShells'];
  };
  const shells = {
    cab: startShells(CAB_SHELL_URLS, { onAttached, enabled: false }),
    body: startShells(BODY_SHELL_URLS, { onAttached, enabled: false }),
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
