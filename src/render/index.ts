import type { GraphicsPreset, SceneRenderer } from '../contracts/render';
import type { Texture } from 'three';
import { proceduralAids } from './aids';
import { proceduralEnvironment } from './environment';
import {
  BODY_SHELL_URLS,
  CAB_SHELL_URLS,
  startGlbAsset,
  startShells,
  trailerShellFrom,
  TRAILER_SHELL_URLS,
} from './glb-shells';
import { createGradeCheck, precompileGrade } from './grade';
import { startGroundTextures } from './ground-texture';
import { readBackendRequest, requestGpuDevice, type BackendRequest } from './gpu-backend';
import { QUALITY_FLAGS } from './quality';
import { startSkyTexture } from './sky-texture';
import { skylineGradeSample } from './skyline';
import { createThreeSceneRenderer } from './three-renderer';
import { createVehicleEnvironment } from './vehicle-pbr';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

/** Whether the preset offers the outside view. */
export const chaseViewAvailable = (preset: GraphicsPreset): boolean =>
  QUALITY_FLAGS[preset].chaseView;

/** Whether the preset draws the cab interior and the mirror housings. */
export const interiorAvailable = (preset: GraphicsPreset): boolean =>
  QUALITY_FLAGS[preset].cockpitInterior;

/** `backend` defaults to the page's `?backend=`. */
export function createSceneRenderer(backend?: BackendRequest): SceneRenderer {
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
    trailer: startGlbAsset(TRAILER_SHELL_URLS, trailerShellFrom, { onAttached, enabled: false }),
  };
  // Read by the offline e2e: the transcoded format while the textured ground is drawn, `failed` once given up on, else absent.
  let groundState: string | null = null;
  const groundTextures = startGroundTextures(undefined, (state) => {
    if (state === null) delete document.documentElement.dataset['groundTexture'];
    else {
      document.documentElement.dataset['groundTexture'] = state;
      if (state !== 'failed' && state !== groundState) warmUp();
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
  // Read by the offline e2e: `on` while the HDRI sky is drawn, `failed` once given up on, else absent.
  let skyState: string | null = null;
  const skyTexture = startSkyTexture(undefined, (state) => {
    if (state === null) delete document.documentElement.dataset['skyHdri'];
    else {
      document.documentElement.dataset['skyHdri'] = state;
      if (state !== 'failed' && state !== skyState) warmUp();
    }
    skyState = state;
  });
  // The vehicles reflect the HDRI sky once it has loaded; pbr and the HDRI are both High-only. The
  // capture is untoned, so without the grade they reflect the analytic sky instead.
  let skyMap: Texture | null = null;
  let gradeFailed = false;
  const syncReflection = (): void => {
    vehicleEnvironment.setSky(gradeFailed ? null : skyMap);
  };
  skyTexture.onLoaded(
    ({ sky }) => {
      skyMap = sky;
      syncReflection();
    },
    () => {
      skyMap = null;
      syncReflection();
    },
  );
  // Read by the offline e2e: `on` once the perspective grade compiled while the preset grades, `failed` if it fell back.
  const gradeCheck = createGradeCheck(
    (state) => {
      gradeFailed = state === 'failed';
      syncReflection();
      if (state === null) delete document.documentElement.dataset['perspectiveGrade'];
      else {
        document.documentElement.dataset['perspectiveGrade'] = state;
        if (state !== 'failed') warmUp();
      }
    },
    (gpu) => precompileGrade(gpu, [skylineGradeSample]),
  );
  const renderer = createThreeSceneRenderer({
    gpuDevice: () => requestGpuDevice(backend ?? readBackendRequest(location.search)),
    onRenderer: (gpu) => {
      groundTextures.attach(gpu);
      skyTexture.attach(gpu);
      vehicleEnvironment.attach(gpu);
      gradeCheck.attach(gpu);
    },
    truck: (spec, palette) => proceduralTruck(spec, palette, shells, vehicleEnvironment),
    trailer: (spec, palette) =>
      proceduralTrailer(spec, palette, shells.trailer, vehicleEnvironment),
    environment: (layout, palette) =>
      proceduralEnvironment(layout, palette, groundTextures, skyTexture),
    aids: proceduralAids,
  });
  // Read by the e2e: the GPU API of the live renderer and why it is not WebGPU when that was asked
  // for, absent while there is no renderer.
  const marker = document.documentElement.dataset;
  const unmark = (): void => {
    delete marker['renderBackend'];
    delete marker['renderFallback'];
  };
  renderer.onLost(unmark);
  const { warmUp: warmTarget, ...sceneRenderer } = renderer;
  warm.target = warmTarget;
  if (warm.pending) warmTarget();
  return {
    ...sceneRenderer,
    async init(canvas) {
      await renderer.init(canvas);
      const { backend: drawn, webgpuFallback } = renderer.stats();
      marker['renderBackend'] = drawn;
      if (webgpuFallback === null) delete marker['renderFallback'];
      else marker['renderFallback'] = webgpuFallback;
    },
    setQuality(preset) {
      const flags = QUALITY_FLAGS[preset];
      shells.cab.setEnabled(flags.cabGlb);
      shells.body.setEnabled(flags.vehicleGlb);
      shells.trailer.setEnabled(flags.vehicleGlb);
      groundTextures.setEnabled(flags.groundTexture);
      skyTexture.setEnabled(flags.hdriSky);
      gradeCheck.setWanted(flags.perspectiveLighting);
      renderer.setQuality(preset);
    },
    dispose() {
      unmark();
      renderer.dispose();
      groundTextures.dispose();
      skyTexture.dispose();
      vehicleEnvironment.dispose();
      gradeCheck.dispose();
    },
  };
}
