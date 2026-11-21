import { BoxGeometry, Float32BufferAttribute, Mesh, SpotLight } from 'three';
import {
  attribute,
  diffuseColor,
  exp,
  float,
  mix,
  normalView,
  positionViewDirection,
  vec3,
} from 'three/tsl';
import {
  MeshLambertNodeMaterial,
  type Node,
  type NodeBuilder,
  PhongLightingModel,
} from 'three/webgpu';
import { GRADE_SHADER_MARKER, setGraded, type GradeSample } from './grade';
import { BEAM } from './lamp-light';
import { RETRO_ATTRIBUTE, withRetro } from './tint';

/*
 * Retro-reflective yard parts at night. A part carries `retro` (1 on sheeting, 0 elsewhere) as a
 * vertex attribute, set from its type alone. The night-only material adds, for every light, a lobe
 * that grows as the angle between the light and the viewer, seen from the surface, shrinks. At night
 * the sun is off, so only the lamps drive it; by day the plain props material draws, so day output
 * is unchanged.
 */

/** Named in the generated shader, so a shader error can be traced to this material. */
export const RETRO_SHADER_MARKER = 'retroSheeting';

export const RETRO = {
  /** Multiplies the light that reaches the surface. */
  gain: 2.5,
  /** Steepness of the lobe in `1 - cos(angle)` between the light and the viewer. */
  sharpness: 24,
  /** Share of white in the sheeting's colour, so black bands still return light. */
  white: 0.5,
} as const;

/** Share (0 to 1) of the return at an observation angle between the light and the viewer, in radians. */
export const retroLobe = (angle: number): number =>
  Math.exp(-RETRO.sharpness * (1 - Math.cos(angle)));

/** Lambert, plus the retro lobe of each light on the vertices that carry `retro`. */
class RetroLightingModel extends PhongLightingModel {
  private sheeting: Node<'float'> | null = null;

  constructor() {
    super(false);
  }

  override start(builder: NodeBuilder): void {
    this.sheeting = attribute<'float'>(RETRO_ATTRIBUTE).toVar(RETRO_SHADER_MARKER);
    super.start(builder);
  }

  override direct(...args: Parameters<PhongLightingModel['direct']>): void {
    super.direct(...args);
    if (this.sheeting === null) return;
    const [data] = args;
    const lightDirection = data.lightDirection as Node<'vec3'>;
    const lightColor = data.lightColor as Node<'vec3'>;
    const reflected = data.reflectedLight.directDiffuse as Node<'vec3'>;
    const facing = normalView.dot(lightDirection).clamp();
    const observed = lightDirection.dot(positionViewDirection).clamp();
    const lobe = exp(float(1).sub(observed).mul(-RETRO.sharpness));
    const colour = mix(diffuseColor.rgb, vec3(1), RETRO.white);
    reflected.addAssign(
      lightColor.mul(facing).mul(lobe).mul(this.sheeting).mul(RETRO.gain).mul(colour),
    );
  }
}

export class RetroNodeMaterial extends MeshLambertNodeMaterial {
  static override get type(): string {
    return 'RetroNodeMaterial';
  }

  override setupLightingModel(): PhongLightingModel {
    return new RetroLightingModel();
  }
}

/** The graded retro material on a box under a spot light: the program the props build at night. */
export function retroLitSample(): GradeSample {
  const geometry = withRetro(new BoxGeometry(), 1);
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const material = new RetroNodeMaterial({ vertexColors: true });
  setGraded(material, true);
  const light = new SpotLight(0xffffff, 1, BEAM.distance, BEAM.angle, BEAM.penumbra, 2);
  return {
    mesh: new Mesh(geometry, material),
    lights: [light],
    markers: [RETRO_SHADER_MARKER, GRADE_SHADER_MARKER],
    dispose: () => {
      light.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
