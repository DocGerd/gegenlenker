// Perspective-only realism hues (docs/brand/BRAND.md). Never on top-down top faces; not scene tokens.
// sRGB, like the scene palette: set a `Color` from the number (`color.set` converts to linear).
export const REALISM_HUES = {
  signalYellow: 0xf9a800, // RAL 1003 impact guard, underrun bars
  chevronBlack: 0x101214,
  contourSide: 0xeeeeea, // ECE R48/R104 contour marking, sides: white, as on the THW fleet
  contourSideYellow: 0xf2c200, // the lafette glb's baked side contour, until that shell is rebuilt white
  contourRear: 0xd0201c, // contour marking, rear
  tailLamp: 0xc8102e,
  sideMarker: 0xffb000,
  plateWhite: 0xf4f4ee,
  plateInk: 0x0a0a0a,
  plateEuBlue: 0x003399,
  plateEuStar: 0xffcc00,
  anthracite: 0x293133, // RAL 7016
  whiteAluminium: 0xa5a5a5, // RAL 9006
  containerBlue: 0x1e4a8a,
  containerRed: 0x9a2d22,
  containerGreen: 0x2f6b4a,
  containerOrange: 0xc9661c,
  concrete: 0x8c8c86, // precast concrete: kerbs, walls, loading ramps
  coneRed: 0xcc0605, // RAL 3020 traffic red, cone body
  skylineDark: 0x5c6875, // distant industrial silhouettes
  skyHaze: 0xdcebf2, // horizon haze, pale blue-grey
  windowLight: 0xffc27a, // lit office windows of the skyline at night
  sunHalo: 0xfff1d0, // warm glow around the sun
  nightHorizon: 0x18243f, // night sky dome at the horizon; the haze fades to it
  nightZenith: 0x03050a, // night sky dome overhead
  thwBlue: 0x00387b, // THW cab, body and tarpaulin; RAL 5002 sRGB approximation
  thwBlueDeep: 0x00214a, // low-loader side members and crossmembers, a darker THW blue
  liveryWhite: 0xf6f6f6, // THW bumper, corners, arches and side stripe; RAL 9016
  beaconBlue: 0x1f6fe5, // roof light bar lens
  headliner: 0x6f716a, // cab roof header lining
} as const;

export type RealismHueKey = keyof typeof REALISM_HUES;

/** Fictional plate text; never a real registration. */
export const PLATE_TEXT = 'GL-GL 2026';
