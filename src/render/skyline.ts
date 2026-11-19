import type { Rect2 } from '../contracts/layout';
import { SKY_LAYER } from './seams';
import { createAtlasTexture } from './skyline-atlas';
import { skylineGeometry } from './skyline-geometry';
import { skylineBuildings } from './skyline-layout';
import { Color, Mesh } from 'three';
import { attribute, mix, output, uniform, vec4 } from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';

/**
 * Lambert with a per-vertex haze share mixed towards the haze colour after lighting, so a distant
 * building fades as a whole instead of showing a vertical gradient.
 */
function hazeMaterial(haze: Color): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial({ map: createAtlasTexture() });
  material.outputNode = vec4(mix(output.rgb, uniform(haze), attribute('haze', 'float')), output.a);
  return material;
}

export type Skyline = { readonly mesh: Mesh; dispose(): void };

/** Solid buildings around `bounds`, lit by the scene lights and fading towards `haze` with distance. */
export function createSkyline(bounds: Rect2, haze: Color): Skyline {
  const geometry = skylineGeometry(skylineBuildings(bounds));
  const material = hazeMaterial(haze.clone());
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.layers.set(SKY_LAYER);
  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
  };
}
