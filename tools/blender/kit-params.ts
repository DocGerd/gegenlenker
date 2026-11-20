import { YARD_KIT_DIMS, YARD_KIT_HUES } from '../../src/render/yard-kit-dims';
import { ASSET_SOURCES, KIT_INPUT_DIR } from '../assets/sources';

/** [x, y, width, height] in texels, origin at the image's top-left corner. */
type Rect = readonly [number, number, number, number];

/** The names the bake script and the atlas params use for the `ASSET_SOURCES` ids. */
const KIT_SOURCE_IDS = {
  corrugatedIron: 'corrugated-iron-02',
  corrugatedSteel: 'corrugated-steel-007a',
  concreteFloor: 'concrete-floor-02',
  facade: 'facade-001',
  containerSide: 'container-side',
  leafSet: 'leaf-set-009',
  foliage: 'foliage-001',
} as const;

/** What the script reads: the source page, its licence and each file's SHA-256 by path under `SOURCES_DIR`. */
const sources = (ids: readonly (keyof typeof KIT_SOURCE_IDS)[]) =>
  Object.fromEntries(
    ids.map((id) => {
      const source = ASSET_SOURCES[KIT_SOURCE_IDS[id]];
      if (source === undefined) throw new Error(`ASSET_SOURCES has no ${KIT_SOURCE_IDS[id]}`);
      return [
        id,
        {
          url: source.page,
          licence: source.licence,
          files: Object.fromEntries(
            source.files.map((file) => [file.path.slice(KIT_INPUT_DIR.length), file.sha256]),
          ),
        },
      ];
    }),
  );

/** Which file of a source holds which map; `ao: null` means none (AO = 1). */
const POLY_HAVEN_MAPS = { colour: 'diff', normal: 'nor_gl', roughness: 'arm:g', ao: 'arm:r' };
const AMBIENT_CG_MAPS = { colour: 'Color', normal: 'NormalGL', roughness: 'Roughness', ao: null };

/**
 * Yard-kit atlas (1024²): textured tiles, which a face samples from the tile's corner at `span`
 * metres per tile (capped at one tile, since the atlas cannot repeat), and a grid of flat swatches
 * whose faces sample the cell centre. `contrast` scales the tile's albedo about its mean; `gutter`
 * insets the UVs from the tile edge.
 */
const YARD_ATLAS = {
  size: 1024,
  gutter: 8,
  tiles: {
    cladding: {
      rect: [0, 0, 512, 512] as Rect,
      source: 'corrugatedIron',
      tint: 'cladding',
      span: [5, 7],
      contrast: 1,
    },
    door: {
      rect: [512, 0, 512, 512] as Rect,
      source: 'corrugatedSteel',
      tint: 'door',
      span: [4, 4.5],
      contrast: 1,
    },
    concrete: {
      rect: [0, 512, 512, 512] as Rect,
      source: 'concreteFloor',
      tint: null,
      span: [5, 5],
      contrast: 0.8,
    },
    glazing: {
      rect: [512, 512, 256, 256] as Rect,
      source: 'facade',
      tint: null,
      span: [3, 3],
      contrast: 1,
    },
    container: {
      rect: [768, 512, 256, 256] as Rect,
      source: 'containerSide',
      tint: 'container',
      span: [1.4, 1.4],
      contrast: 1,
    },
    plaster: {
      rect: [512, 768, 256, 256] as Rect,
      source: 'concreteFloor',
      tint: 'plaster',
      span: [3, 3.3],
      contrast: 0.3,
    },
  },
  swatches: {
    origin: [768, 768],
    cell: 64,
    columns: 4,
    roughness: {
      glass: 0.08,
      frame: 0.45,
      roof: 0.8,
      zinc: 0.4,
      doorJoint: 0.6,
      hedgeCore: 0.95,
      bark: 0.95,
      wood: 0.8,
      hydrant: 0.5,
      signRed: 0.4,
      signWhite: 0.4,
      bin: 0.6,
      saltBin: 0.55,
      galvanised: 0.45,
    },
  },
  maps: {
    corrugatedIron: POLY_HAVEN_MAPS,
    concreteFloor: POLY_HAVEN_MAPS,
    containerSide: POLY_HAVEN_MAPS,
    facade: AMBIENT_CG_MAPS,
    corrugatedSteel: { ...AMBIENT_CG_MAPS, ao: 'AmbientOcclusion' },
  },
} as const;

/**
 * Leaf atlas (1024², RGBA): composited cluster cards. `leaves` sprites are cut from the six leaves of
 * LeafSet009 (a 3 x 2 grid) and scattered `count` times at `size` texels; the tuft is Foliage001 whole.
 */
const LEAF_ATLAS = {
  size: 1024,
  gutter: 4,
  sprites: { columns: 3, rows: 2 },
  clusters: {
    lime: { rect: [0, 0, 512, 512] as Rect, count: 170, size: [34, 50], seed: 5, shape: 'disc' },
    maple: { rect: [512, 0, 512, 512] as Rect, count: 150, size: [40, 58], seed: 7, shape: 'disc' },
    hedge: {
      rect: [0, 512, 512, 512] as Rect,
      count: 420,
      size: [18, 28],
      seed: 13,
      shape: 'fill',
    },
  },
  tuft: { rect: [512, 512, 512, 512] as Rect },
} as const;

/** Inputs of `tools/blender/yard_kit.py`. */
export function yardKitParams() {
  return {
    schema: 1,
    dims: YARD_KIT_DIMS,
    hues: YARD_KIT_HUES,
    atlas: YARD_ATLAS,
    leafAtlas: LEAF_ATLAS,
    sources: sources([
      'corrugatedIron',
      'corrugatedSteel',
      'concreteFloor',
      'facade',
      'containerSide',
      'leafSet',
      'foliage',
    ]),
  };
}
