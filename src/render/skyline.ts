import type { Rect2 } from '../contracts/layout';
import { SKY_LAYER } from './seams';
import { createAtlasTexture } from './skyline-atlas';
import { skylineGeometry } from './skyline-geometry';
import { skylineBuildings } from './skyline-layout';
import { Color, Mesh, MeshLambertMaterial } from 'three';

/**
 * Lambert with a per-vertex haze share mixed towards the haze colour after lighting, so a distant
 * building fades as a whole instead of showing a vertical gradient.
 */
function hazeMaterial(haze: Color): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ map: createAtlasTexture() });
  material.onBeforeCompile = (shader) => {
    shader.uniforms['hazeColor'] = { value: haze };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float haze;\nvarying float vHaze;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHaze = haze;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 hazeColor;\nvarying float vHaze;',
      )
      .replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, vHaze);',
      );
  };
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
