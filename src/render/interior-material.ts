import { BoxGeometry, DirectionalLight, Float32BufferAttribute, Mesh, type Texture } from 'three';
import { float, vertexColor } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { GRADE, GRADE_SHADER_MARKER, type GradeSample, setGraded } from './grade';
import { VehicleLightingModel } from './vehicle-pbr';

/*
 * The cab interior's lit material for the High preset (#159). Unlike the vehicle shell's, it has no
 * glass role: the dash is anthracite, which the shell reads as a mirror. A satin plastic keeps the
 * highlights faint, so the dash neither glares in the windscreen nor washes out. The sky map goes on
 * the material, never on `scene.environment`.
 */

const ROUGHNESS = 0.75;
/** Share of the reflections and sun highlight the plastic keeps. */
const SPECULAR = 0.2;

/** Named in the generated shader, so a shader error can be traced to this material. */
export const INTERIOR_SHADER_MARKER = 'interiorLit';

export class InteriorNodeMaterial extends MeshStandardNodeMaterial {
  static override get type(): string {
    return 'InteriorNodeMaterial';
  }

  constructor(envMap: Texture | null = null) {
    // the vertex colour is folded into colorNode
    super({ vertexColors: false, roughness: ROUGHNESS, metalness: 0, envMap });
    this.colorNode = vertexColor().rgb.mul(GRADE.interiorLight).toVar(INTERIOR_SHADER_MARKER);
  }

  override setupLightingModel(): VehicleLightingModel {
    return new VehicleLightingModel(float(SPECULAR));
  }
}

/**
 * The grade check's sample: the graded interior material on a shadow receiver under a casting sun,
 * the program the cockpit view builds on High.
 */
export function interiorSample(): GradeSample {
  const geometry = new BoxGeometry();
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(24 * 3), 3));
  const material = new InteriorNodeMaterial();
  setGraded(material, true);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  const sun = new DirectionalLight();
  sun.castShadow = true;
  return {
    mesh,
    lights: [sun],
    markers: [INTERIOR_SHADER_MARKER, GRADE_SHADER_MARKER],
    dispose: () => {
      sun.shadow.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
