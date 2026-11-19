import type { QualityFlags } from './quality';

export type AssetKind = 'glb' | 'ktx2';

type BooleanFlag = {
  [K in keyof QualityFlags]: QualityFlags[K] extends boolean ? K : never;
}[keyof QualityFlags];

/** The quality flag that draws each binary in `src/render/assets`, keyed by file stem. */
export const ASSET_REGISTRY: Readonly<
  Record<string, { readonly kind: AssetKind; readonly flag: BooleanFlag }>
> = {
  'arocs-1835-ak-cab': { kind: 'glb', flag: 'cabGlb' },
  'man-le-18-280-cab': { kind: 'glb', flag: 'cabGlb' },
  'arocs-1835-ak-body': { kind: 'glb', flag: 'vehicleGlb' },
  'man-le-18-280-body': { kind: 'glb', flag: 'vehicleGlb' },
  'hueffermann-hpa-24-81-l-trailer': { kind: 'glb', flag: 'vehicleGlb' },
  'krone-azw-18-trailer': { kind: 'glb', flag: 'vehicleGlb' },
  ground: { kind: 'ktx2', flag: 'groundTexture' },
  sky: { kind: 'ktx2', flag: 'hdriSky' },
};
