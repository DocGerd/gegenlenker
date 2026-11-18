import type { GraphicsPreset, SceneRenderer } from '../contracts/render';
import { proceduralAids } from './aids';
import { proceduralEnvironment } from './environment';
import { BODY_SHELL_URLS, CAB_SHELL_URLS, startShells } from './glb-shells';
import { startGroundTextures } from './ground-texture';
import { QUALITY_FLAGS } from './quality';
import { createThreeSceneRenderer } from './three-renderer';
import { createVehicleEnvironment } from './vehicle-pbr';
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
  // Read by the offline e2e: the transcoded format while the textured ground is drawn, else absent.
  const groundTextures = startGroundTextures(undefined, (state) => {
    if (state === null) delete document.documentElement.dataset['groundTexture'];
    else document.documentElement.dataset['groundTexture'] = state;
  });
  // Read by the offline e2e: `on` once the vehicle reflections are built, `failed` if they fell back.
  const vehicleEnvironment = createVehicleEnvironment((state) => {
    if (state === null) delete document.documentElement.dataset['vehiclePbr'];
    else document.documentElement.dataset['vehiclePbr'] = state;
  });
  const renderer = createThreeSceneRenderer({
    onRenderer: (gl) => {
      groundTextures.attach(gl);
      vehicleEnvironment.attach(gl);
    },
    onContextRestored: () => {
      vehicleEnvironment.invalidate();
    },
    truck: (spec, palette) => proceduralTruck(spec, palette, shells, vehicleEnvironment),
    trailer: (spec, palette) => proceduralTrailer(spec, palette, vehicleEnvironment),
    environment: (layout, palette) => proceduralEnvironment(layout, palette, groundTextures),
    aids: proceduralAids,
  });
  return {
    ...renderer,
    setQuality(preset) {
      const flags = QUALITY_FLAGS[preset];
      shells.cab.setEnabled(flags.cabGlb);
      shells.body.setEnabled(flags.vehicleGlb);
      groundTextures.setEnabled(flags.groundTexture);
      renderer.setQuality(preset);
    },
    dispose() {
      renderer.dispose();
      groundTextures.dispose();
      vehicleEnvironment.dispose();
    },
  };
}
