import type { Rect2 } from '../contracts/layout';
import { PERSPECTIVE_LAYER } from './seams';
import { CELL, createAtlasTexture, GLASS_RECT, GRID } from './skyline-atlas';
import { GLOW_ATTRIBUTE, skylineGeometry } from './skyline-geometry';
import { skylineBuildings } from './skyline-layout';
import { BoxGeometry, Color, DataTexture, Float32BufferAttribute, Mesh } from 'three';
import {
  attribute,
  clamp,
  fract,
  fwidth,
  max,
  min,
  mix,
  output,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
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

/** Named in the generated shader, so a check can tell the window glow was built. */
export const SKYLINE_WINDOW_MARKER = 'skylineWindows';

const WINDOW_LIGHT = new Color(REALISM_HUES.windowLight);
/** Widest edge blur, in cell widths: past it a derivative is a quad seam, not a minified edge. */
const EDGE_BLUR = 0.2;

/** Cell fractions of the glass, in the cell's frame with v up. */
const GLASS_LO = vec2(GLASS_RECT.x0 / CELL, 1 - GLASS_RECT.y1 / CELL);
const GLASS_HI = vec2(GLASS_RECT.x1 / CELL, 1 - GLASS_RECT.y0 / CELL);

/** Warm light behind the glass of the windows the geometry marks lit, scaled by `on`; zero when `on` is. */
function windowGlow(on: Node<'float'>): Node<'vec3'> {
  const local = fract(uv().mul(GRID));
  const width = fwidth(local);
  const edge = vec2(min(width.x, EDGE_BLUR), min(width.y, EDGE_BLUR)).max(1e-4);
  const inside = clamp(local.sub(GLASS_LO).div(edge).add(0.5), 0, 1).mul(
    clamp(GLASS_HI.sub(local).div(edge).add(0.5), 0, 1),
  );
  const colour = vec3(WINDOW_LIGHT.r, WINDOW_LIGHT.g, WINDOW_LIGHT.b);
  return attribute<'float'>(GLOW_ATTRIBUTE)
    .mul(inside.x.mul(inside.y))
    .mul(colour)
    .mul(on)
    .toVar(SKYLINE_WINDOW_MARKER);
}

export type Skyline = {
  readonly mesh: Mesh;
  /** Takes the shared haze colour, aerial perspective and tone mapping (`grade.ts`). */
  setGraded(on: boolean): void;
  /** The colour a building fades to without the grade, which brings its own haze. */
  setHaze(haze: Color): void;
  /** Lights the windows the geometry marks lit; a uniform, so no shader changes. */
  setWindows(on: boolean): void;
  dispose(): void;
};

/** Solid buildings around `bounds`, lit by the scene lights and fading towards `haze` with distance. */
export function createSkyline(bounds: Rect2, haze: Color): Skyline {
  const geometry = skylineGeometry(skylineBuildings(bounds));
  const material = new MeshLambertNodeMaterial({ map: createAtlasTexture() });
  const plainColour = uniform(haze.clone());
  const plain = plainHaze(plainColour);
  material.outputNode = plain;
  const windowsOn = uniform(0);
  material.emissiveNode = windowGlow(windowsOn);
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
    setWindows: (on) => {
      windowsOn.value = on ? 1 : 0;
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
  geometry.setAttribute(GLOW_ATTRIBUTE, new Float32BufferAttribute(new Float32Array(24), 1));
  const map = new DataTexture(new Uint8Array(4), 1, 1);
  map.needsUpdate = true;
  const material = new MeshLambertNodeMaterial({ map });
  material.emissiveNode = windowGlow(uniform(0));
  setGraded(material, true, plainHaze(uniform(new Color(REALISM_HUES.skyHaze))), gradedHaze());
  return {
    mesh: new Mesh(geometry, material),
    markers: [GRADE_SHADER_MARKER, SKYLINE_WINDOW_MARKER],
    dispose: () => {
      geometry.dispose();
      map.dispose();
      material.dispose();
    },
  };
}
