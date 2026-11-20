import type { Rect2 } from '../contracts/layout';
import { PERSPECTIVE_LAYER } from './seams';
import { createAtlasTexture } from './skyline-atlas';
import { skylineGeometry } from './skyline-geometry';
import { skylineBuildings } from './skyline-layout';
import { BoxGeometry, Color, DataTexture, Float32BufferAttribute, Mesh } from 'three';
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
const plainHaze = (haze: Node<'color'>): Node<'vec4'> =>
  vec4(mix(output.rgb, haze, attribute('haze', 'float')), output.a);

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
  /** The colour a building fades to without the grade, which brings its own haze. */
  setHaze(haze: Color): void;
  dispose(): void;
};

/** Solid buildings around `bounds`, lit by the scene lights and fading towards `haze` with distance. */
export function createSkyline(bounds: Rect2, haze: Color): Skyline {
  const geometry = skylineGeometry(skylineBuildings(bounds));
  const material = new MeshLambertNodeMaterial({ map: createAtlasTexture() });
  const plainColour = uniform(haze.clone());
  const plain = plainHaze(plainColour);
  material.outputNode = plain;
  const grade = gradedHaze();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.layers.set(PERSPECTIVE_LAYER);
  return {
    mesh,
    setGraded: (on) => {
      setGraded(material, on, plain, grade);
    },
    setHaze: (next) => {
      plainColour.value.copy(next);
    },
    dispose: () => {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
  };
}

/**
 * The graded skyline material on a box with the same attributes and a 1 × 1 map, for the grade's
 * shader check: the same program without building the skyline and its atlas on every new renderer.
 */
export function skylineGradeSample(): GradeSample {
  const geometry = new BoxGeometry();
  geometry.setAttribute('haze', new Float32BufferAttribute(new Float32Array(24), 1));
  const map = new DataTexture(new Uint8Array(4), 1, 1);
  map.needsUpdate = true;
  const material = new MeshLambertNodeMaterial({ map });
  setGraded(material, true, plainHaze(uniform(new Color(REALISM_HUES.skyHaze))), gradedHaze());
  return {
    mesh: new Mesh(geometry, material),
    dispose: () => {
      geometry.dispose();
      map.dispose();
      material.dispose();
    },
  };
}
