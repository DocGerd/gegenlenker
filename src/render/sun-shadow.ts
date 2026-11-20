import { Vector3, type Camera, type DirectionalLight } from 'three';
import { KIT_FOOTPRINTS } from '../content/kit';
import { enableLayers, SHADOW_CASTER_LAYERS, type ShadowFocus } from './seams';

export const SUN_DISTANCE = 100;
export const SHADOW_MAP_SIZE = 2048;
/** Half the box's side per metre of focus radius. */
const REACH = 1.5;
/** Height (m) of the tallest caster other than the kit's pieces. */
const OTHER_CASTER_HEIGHT = 12;
/**
 * Height (m) of the tallest caster that may shade the focus. The light is orthographic, so a caster
 * shades the focus only from inside the box's column and only the near plane clips it: the depth
 * range reaches this high. Casters outside the column are left out of the map.
 */
export const CASTER_HEIGHT = Math.max(
  OTHER_CASTER_HEIGHT,
  ...Object.values(KIT_FOOTPRINTS).map((piece) => piece.height),
);
const DEPTH_MARGIN = 1;

export type SunShadowFit = {
  readonly position: Vector3;
  readonly target: Vector3;
  /** Half the side of the orthographic box (m). */
  readonly half: number;
  readonly near: number;
  readonly far: number;
};

const shadowCameras = new WeakSet<Camera>();

/** Whether `camera` is a sun shadow camera made by `prepareShadow`. */
export function isShadowCamera(camera: Camera): boolean {
  return shadowCameras.has(camera);
}

/** One shadow render per queued frame, of the caster layers only. */
export function prepareShadow(light: DirectionalLight): void {
  const { shadow } = light;
  shadow.autoUpdate = false;
  shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  // three copies the viewing camera's layers when only layer 0 is set
  shadow.camera.layers.disableAll();
  enableLayers(shadow.camera.layers, SHADOW_CASTER_LAYERS);
  shadowCameras.add(shadow.camera);
}

/** Asks for the map to be drawn at the next render that lights with this sun. */
export function queueShadow(light: DirectionalLight): void {
  light.shadow.needsUpdate = light.castShadow;
}

/**
 * An orthographic box over the focus, looking along `-sunDir`. Its size depends on the radius
 * only, and its centre sits on the map's texel grid in light space so the shadows do not crawl as
 * the focus moves. Depth reaches the tallest caster towards the sun and the longest shadow it casts away from it.
 */
export function fitSunShadow(focus: ShadowFocus, sunDir: Vector3, mapSize: number): SunShadowFit {
  const d = sunDir.clone().normalize();
  const right = new Vector3(d.z, 0, -d.x).normalize();
  const up = new Vector3().crossVectors(d, right);
  const half = focus.radius * REACH;
  const texel = (2 * half) / mapSize;

  const centre = new Vector3(focus.x, 0, -focus.y);
  const snapped = new Vector3()
    .addScaledVector(right, Math.round(centre.dot(right) / texel) * texel)
    .addScaledVector(up, Math.round(centre.dot(up) / texel) * texel)
    .addScaledVector(d, centre.dot(d));

  const horizontal = Math.hypot(d.x, d.z);
  const towardSun = focus.radius * horizontal + CASTER_HEIGHT / d.y;
  const behind = horizontal * (focus.radius + (CASTER_HEIGHT * horizontal) / d.y);
  return {
    position: snapped.clone().addScaledVector(d, SUN_DISTANCE),
    target: snapped,
    half,
    near: SUN_DISTANCE - towardSun - DEPTH_MARGIN,
    far: SUN_DISTANCE + behind + DEPTH_MARGIN,
  };
}
