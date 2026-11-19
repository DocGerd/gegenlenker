import type { GraphicsPreset, SceneRenderer } from '../contracts/render';
import { proceduralAids } from './aids';
import { proceduralEnvironment } from './environment';
import {
  BODY_SHELL_URLS,
  CAB_SHELL_URLS,
  fetchTrailerShell,
  startShells,
  TRAILER_SHELL_URLS,
} from './glb-shells';
import { startGroundTextures } from './ground-texture';
import { QUALITY_FLAGS } from './quality';
import { startSkyTexture } from './sky-texture';
import { createThreeSceneRenderer } from './three-renderer';
import { createVehicleEnvironment } from './vehicle-pbr';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

/** Whether the preset offers the outside view. */
export const chaseViewAvailable = (preset: GraphicsPreset): boolean =>
  QUALITY_FLAGS[preset].chaseView;

/** Whether the preset draws the cab interior and the mirror housings. */
export const interiorAvailable = (preset: GraphicsPreset): boolean =>
  QUALITY_FLAGS[preset].cockpitInterior;

export function createSceneRenderer(): SceneRenderer {
  // The attach callbacks may fire before the renderer exists; a call made then is replayed once it does.
  const warm: { target: (() => void) | null; pending: boolean } = { target: null, pending: false };
  const warmUp = (): void => {
    if (warm.target === null) warm.pending = true;
    else warm.target();
  };
  // Positive signal for the offline e2e: the shells now attached to a vehicle, sorted and
  // space-separated; absent when none is. Each group loads on the first preset that wants it.
  const attached = new Set<string>();
  const onAttached = (key: string, on: boolean): void => {
    if (on) {
      attached.add(key);
      warmUp();
    } else attached.delete(key);
    const { dataset } = document.documentElement;
    if (attached.size > 0) dataset['vehicleShells'] = [...attached].sort().join(' ');
    else delete dataset['vehicleShells'];
  };
  const shells = {
    cab: startShells(CAB_SHELL_URLS, { onAttached, enabled: false }),
    body: startShells(BODY_SHELL_URLS, { onAttached, enabled: false }),
    trailer: startShells(TRAILER_SHELL_URLS, {
      load: fetchTrailerShell,
      onAttached,
      enabled: false,
    }),
  };
  // Read by the offline e2e: the transcoded format while the textured ground is drawn, else absent.
  let groundState: string | null = null;
  const groundTextures = startGroundTextures(undefined, (state) => {
    if (state === null) delete document.documentElement.dataset['groundTexture'];
    else {
      document.documentElement.dataset['groundTexture'] = state;
      if (state !== groundState) warmUp();
    }
    groundState = state;
  });
  // Read by the offline e2e: `on` once the vehicle reflections are built, `failed` if they fell back.
  let pbrState: string | null = null;
  const vehicleEnvironment = createVehicleEnvironment((state) => {
    if (state === null) delete document.documentElement.dataset['vehiclePbr'];
    else {
      document.documentElement.dataset['vehiclePbr'] = state;
      if (state !== 'failed' && state !== pbrState) warmUp();
    }
    pbrState = state;
  });
  // Read by the offline e2e: `on` while the HDRI sky is drawn, else absent.
  let skyState: string | null = null;
  const skyTexture = startSkyTexture(undefined, (state) => {
    if (state === null) delete document.documentElement.dataset['skyHdri'];
    else {
      document.documentElement.dataset['skyHdri'] = state;
      if (state !== skyState) warmUp();
    }
    skyState = state;
  });
  // the vehicles reflect the HDRI sky once it has loaded; pbr and the HDRI are both High-only
  skyTexture.onLoaded(
    (map) => {
      vehicleEnvironment.setSky(map);
    },
    () => {
      vehicleEnvironment.setSky(null);
    },
  );
  const renderer = createThreeSceneRenderer({
    onRenderer: (gpu) => {
      groundTextures.attach(gpu);
      skyTexture.attach(gpu);
      vehicleEnvironment.attach(gpu);
    },
    truck: (spec, palette) => proceduralTruck(spec, palette, shells, vehicleEnvironment),
    trailer: (spec, palette) =>
      proceduralTrailer(spec, palette, shells.trailer, vehicleEnvironment),
    environment: (layout, palette) =>
      proceduralEnvironment(layout, palette, groundTextures, skyTexture),
    aids: proceduralAids,
  });
  // Read by the e2e: the GPU API of the live renderer, absent while there is none.
  renderer.onLost(() => {
    delete document.documentElement.dataset['renderBackend'];
  });
  const { warmUp: warmTarget, ...sceneRenderer } = renderer;
  warm.target = warmTarget;
  if (warm.pending) warmTarget();
  return {
    ...sceneRenderer,
    async init(canvas) {
      await renderer.init(canvas);
      document.documentElement.dataset['renderBackend'] = renderer.stats().backend;
    },
    setQuality(preset) {
      const flags = QUALITY_FLAGS[preset];
      shells.cab.setEnabled(flags.cabGlb);
      shells.body.setEnabled(flags.vehicleGlb);
      shells.trailer.setEnabled(flags.vehicleGlb);
      groundTextures.setEnabled(flags.groundTexture);
      skyTexture.setEnabled(flags.hdriSky);
      renderer.setQuality(preset);
    },
    dispose() {
      delete document.documentElement.dataset['renderBackend'];
      renderer.dispose();
      groundTextures.dispose();
      skyTexture.dispose();
      vehicleEnvironment.dispose();
    },
  };
}
