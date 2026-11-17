// Perspective-only realism hues (docs/brand/BRAND.md). Never on top-down top faces; not scene tokens.
// sRGB, like the scene palette: set a `Color` from the number (`color.set` converts to linear).
export const REALISM_HUES = {
  signalYellow: 0xf9a800, // RAL 1003 impact guard, underrun bars
  chevronBlack: 0x101214,
  contourSide: 0xf2c200, // ECE R48/R104 contour marking, sides
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
  skylineDark: 0x5c6875, // distant industrial silhouettes
  skyHaze: 0xdcebf2, // horizon haze, pale blue-grey
  sunHalo: 0xfff1d0, // warm glow around the sun
} as const;

export type RealismHueKey = keyof typeof REALISM_HUES;

/** Fictional plate text; never a real registration. */
export const PLATE_TEXT = 'GL-GL 2026';
