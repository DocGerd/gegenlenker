import { REALISM_HUES } from './realism-hues';

// No `three` import: scripts/glb-params.mjs loads this module under plain Node.

const hex = (rgb: number): string => `#${rgb.toString(16).padStart(6, '0')}`;

/**
 * Dimensions of the yard-kit pieces (`tools/blender/yard_kit.py`, `src/render/assets/yard-kit.glb`):
 * surroundings outside the drivable yard, seen from 45 m and more. Metres, in each node's frame:
 * +X along the piece, +Y out of its face (towards the viewer), +Z up; the origin is the centre of
 * the piece's footprint on its face line, at ground level. Render estimates, not vehicle Params.
 */
export const YARD_KIT_DIMS = {
  hall: {
    bay: 5,
    eaves: 7,
    wall: 0.25,
    plinth: 0.6,
    plinthRelief: 0.05,
    fascia: 0.6,
    fasciaRelief: 0.08,
    gutter: 0.15,
    downpipe: 0.05,
    door: { width: 4, height: 4.5, recess: 0.12, frame: 0.1, sections: 5 },
    roofThickness: 0.3,
  },
  office: {
    bay: 3,
    storey: 3.3,
    storeys: 2,
    plinth: 0.4,
    wall: 0.3,
    attica: 0.9,
    coping: 0.06,
    window: { width: 1.8, height: 1.5, sill: 0.9, frame: 0.08, recess: 0.15 },
    entrance: { height: 2.8, canopyDepth: 1.6, canopyThickness: 0.2, mullions: 3 },
    roofThickness: 0.35,
  },
  canopy: { length: 8, depth: 6, clearance: 5.5, column: 0.24, beam: 0.4, roof: 0.15 },
  flagpole: { height: 8, radius: 0.045, footing: 0.4 },
  /** The same grid as the yard fence props (`FENCE` in yard-props.ts). */
  fence: {
    panel: 2.5,
    height: 2,
    barPitch: 0.25,
    barWidth: 0.025,
    rails: 3,
    post: 0.06,
    gate: 4,
    gatePost: 0.12,
  },
  hedge: { length: 2, depth: 0.8, height: 1.4, cards: 4 },
  tuft: { height: 0.45, width: 0.5 },
  trees: [
    {
      id: 'lime-a',
      species: 'lime',
      height: 13,
      crownBase: 3.2,
      crownRadius: 3.6,
      trunk: 0.24,
      seed: 11,
    },
    {
      id: 'lime-b',
      species: 'lime',
      height: 11,
      crownBase: 2.8,
      crownRadius: 3.1,
      trunk: 0.2,
      seed: 23,
    },
    {
      id: 'maple-a',
      species: 'maple',
      height: 12,
      crownBase: 2.6,
      crownRadius: 4.2,
      trunk: 0.26,
      seed: 37,
    },
    {
      id: 'maple-b',
      species: 'maple',
      height: 10,
      crownBase: 2.4,
      crownRadius: 3.6,
      trunk: 0.21,
      seed: 41,
    },
  ],
  /** Leaf-card clusters per tree crown. */
  treeCards: 40,
  props: {
    bin1100: { length: 1.37, depth: 1.07, height: 1.47 },
    bin240: { length: 0.58, depth: 0.73, height: 1.07 },
    hydrant: { radius: 0.11, height: 0.85 },
    bench: { length: 1.8, seat: 0.45, depth: 0.6, back: 0.85 },
    bikeRack: { hoops: 3, pitch: 1, width: 0.8, height: 0.85, tube: 0.024 },
    signPost: { height: 2.6, sign: 0.6 },
    saltBin: { length: 1.2, depth: 0.8, height: 0.8 },
  },
} as const;

/** Node names in `yard-kit.glb`; trees and the hedge carry a second primitive for their leaf cards. */
export const YARD_KIT_NODES = [
  'hall-door-bay',
  'hall-wall-bay',
  'hall-corner',
  'hall-roof',
  'office-bay',
  'office-entrance',
  'office-roof',
  'wash-canopy',
  'flagpole',
  'fence-panel',
  'fence-gate',
  'hedge',
  'grass-tuft',
  ...YARD_KIT_DIMS.trees.map((t) => t.id),
  'bin-1100',
  'bin-240',
  'hydrant',
  'bench',
  'bike-rack',
  'sign-post',
  'salt-bin',
] as const;

/** Flat sRGB colours of the atlas swatches; livery-free, no lettering or emblems. */
export const YARD_KIT_HUES = {
  glass: '#1f2a33',
  frame: hex(REALISM_HUES.anthracite),
  roof: '#4b4f52',
  zinc: '#9aa0a3',
  doorJoint: '#3a3f42',
  hedgeCore: '#2d4a1e',
  bark: '#4a4038',
  wood: '#8a6a48',
  hydrant: '#a72920', // RAL 3000
  signRed: '#c1121c',
  signWhite: '#f4f4f4',
  bin: '#2f3234',
  saltBin: '#e2b007',
  galvanised: '#8e9396',
  /** Tinted tiles: the texture keeps its detail, its mean takes this colour. */
  cladding: '#c3c6c4',
  door: '#d9dcd6',
  plaster: '#d6d1c4',
  container: '#6e7376',
  /** Leaf clusters: mean colour of the opaque texels. */
  lime: '#4f6b2c',
  maple: '#3f5f2a',
  hedge: '#35532a',
  tuft: '#5e7a35',
} as const;
