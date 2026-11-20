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
import { ATTACHMENTS, type AttachmentKey } from './asset-registry';
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
  // The attachment markers on `<html>` (`ATTACHMENTS`) are read by the e2e: the state while drawn,
  // `failed` once given up on, absent otherwise. A new state other than `failed` warms up.
  const publishState = (key: AttachmentKey): ((state: string | null) => void) => {
    const { marker } = ATTACHMENTS[key];
    let last: string | null = null;
    return (state) => {
      const root = document.documentElement;
      if (state === null) root.removeAttribute(marker);
      else {
        root.setAttribute(marker, state);
        if (state !== 'failed' && state !== last) warmUp();
      }
      last = state;
    };
  };
  // The shells now attached to a vehicle, sorted and space-separated. Each group loads on the first
  // preset that wants it.
  const attached = new Set<string>();
  const publishShells = publishState('shells');
  const onAttached = (key: string, on: boolean): void => {
    if (on) attached.add(key);
    else attached.delete(key);
    publishShells(attached.size > 0 ? [...attached].sort().join(' ') : null);
  };
  const shells = {
    cab: startShells(CAB_SHELL_URLS, { onAttached, enabled: false }),
    body: startShells(BODY_SHELL_URLS, { onAttached, enabled: false }),
    trailer: startGlbAsset(TRAILER_SHELL_URLS, trailerShellFrom, { onAttached, enabled: false }),
  };
  // The ground state is the transcoded format while the textured ground is drawn.
  const groundTextures = startGroundTextures(undefined, publishState('ground'));
  // `on` once the vehicle reflections are built, `failed` if they fell back.
  const vehicleEnvironment = createVehicleEnvironment(publishState('pbr'));
  // `on` while the HDRI sky is drawn.
  const skyTexture = startSkyTexture(undefined, publishState('sky'));
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
  // `on` once the perspective grade compiled while the preset grades, `failed` if it fell back.
  const publishGrade = publishState('grade');
  const gradeCheck = createGradeCheck(
    (state) => {
      gradeFailed = state === 'failed';
      syncReflection();
      publishGrade(state);
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
