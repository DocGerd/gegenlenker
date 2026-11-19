import type { Texture } from 'three';
import { attribute, dot, float, min, mix, texture, uv, vec3 } from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { GROUND_TEXTURE_MEAN } from './ground-texture-pixels';
import { GROUND_SHADER_MARKER } from './ground-texture-spec';

/**
 * Lambert shading with the ground map read per vertex-selected channel, scaled so the surface keeps
 * its token brightness on average (the sky below the horizon is matched to it). Bright surfaces
 * would exceed their token with a bright texel, so the detail is clamped to 1 before the vertex
 * colour multiplies it.
 */
export function createGroundMaterial(map: Texture): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial({ vertexColors: true });
  const select = attribute('groundSelect', 'vec3');
  // named, so a shader error can be traced to this material (ground-texture.ts)
  const detail = texture(map, uv()).rgb.toVar(GROUND_SHADER_MARKER);
  const weight = select.x.add(select.y).add(select.z);
  const gain = dot(detail, select).mul(1 / GROUND_TEXTURE_MEAN);
  material.colorNode = vec3(min(mix(float(1), gain, weight), 1));
  return material;
}
