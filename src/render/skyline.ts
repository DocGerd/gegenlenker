import type { Rect2 } from '../contracts/layout';
import { SKY_LAYER } from './seams';
import { createAtlasTexture } from './skyline-atlas';
import { skylineGeometry } from './skyline-geometry';
import { skylineBuildings } from './skyline-layout';
import { Color, Mesh } from 'three';
import { attribute, max, mix, output, uniform, vec4 } from 'three/tsl';
import { MeshLambertNodeMaterial, type Node } from 'three/webgpu';
import {
  fogFactor,
  GRADE_SHADER_MARKER,
  hazeColour,
  setGraded,
  toneMap,
  type GradeSample,
} from './grade';
import { REALISM_HUES } from './realism-hues';

/**
 * Lambert with a per-vertex haze share mixed towards the haze colour after lighting, so a distant
 * building fades as a whole instead of showing a vertical gradient.
 */
const plainHaze = (haze: Color): Node<'vec4'> =>
  vec4(mix(output.rgb, uniform(haze), attribute('haze', 'float')), output.a);

/** The building's own haze already exceeds the aerial perspective out there, so the larger one wins. */
const gradedHaze = (): Node<'vec4'> =>
  vec4(
    toneMap(mix(output.rgb, hazeColour(), max(attribute('haze', 'float'), fogFactor()))).toVar(
      GRADE_SHADER_MARKER,
    ),
    output.a,
  );

export type Skyline = {
  readonly mesh: Mesh;
  /** Takes the shared haze colour, aerial perspective and tone mapping (`grade.ts`). */
  setGraded(on: boolean): void;
  dispose(): void;
};

/** Solid buildings around `bounds`, lit by the scene lights and fading towards `haze` with distance. */
export function createSkyline(bounds: Rect2, haze: Color): Skyline {
  const geometry = skylineGeometry(skylineBuildings(bounds));
  const material = new MeshLambertNodeMaterial({ map: createAtlasTexture() });
  const plain = plainHaze(haze.clone());
  material.outputNode = plain;
  const grade = gradedHaze();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.layers.set(SKY_LAYER);
  return {
    mesh,
    setGraded: (on) => {
      setGraded(material, on, plain, grade);
    },
    dispose: () => {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
  };
}

/** A graded skyline, for the grade's shader check. */
export function skylineGradeSample(): GradeSample {
  const skyline = createSkyline(
    { minX: -40, minY: -40, maxX: 40, maxY: 40 },
    new Color(REALISM_HUES.skyHaze),
  );
  skyline.setGraded(true);
  return {
    mesh: skyline.mesh,
    dispose: () => {
      skyline.dispose();
    },
  };
}
