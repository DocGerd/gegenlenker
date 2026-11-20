import type { QualityFlags } from './quality';

export type AssetKind = 'glb' | 'ktx2';

export type BooleanFlag = {
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

/** An asynchronous attachment that publishes its state on `<html>` for the e2e specs. */
export type Attachment = {
  /** The attribute on `<html>`. */
  readonly marker: string;
  /** The quality flags that must all be on for the attachment to be drawn. */
  readonly flags: readonly BooleanFlag[];
  /** Whether the marker's value says the attachment is in place. */
  readonly ready: (value: string) => boolean;
};

export const ATTACHMENTS = {
  shells: {
    marker: 'data-vehicle-shells',
    flags: ['cabGlb', 'vehicleGlb'],
    ready: (v) => v.split(' ').length === 3,
  },
  ground: {
    marker: 'data-ground-texture',
    flags: ['groundTexture'],
    ready: (v) => v.startsWith('ktx2:'),
  },
  pbr: { marker: 'data-vehicle-pbr', flags: ['pbr'], ready: (v) => v === 'on' },
  sky: { marker: 'data-sky-hdri', flags: ['hdriSky'], ready: (v) => v === 'on' },
  grade: {
    marker: 'data-perspective-grade',
    flags: ['perspectiveLighting'],
    ready: (v) => v === 'on',
  },
} as const satisfies Readonly<Record<string, Attachment>>;

export type AttachmentKey = keyof typeof ATTACHMENTS;
