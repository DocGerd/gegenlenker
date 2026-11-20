/*
 * What the PBR ground textures' pixels depend on besides the sources in tools/textures; this file is
 * hashed into each build manifest, so keep render-only values in ground-pbr-spec.ts.
 */

/** Edge of every PBR ground texture, in texels. */
export const PBR_SIZE = 2048;

/**
 * Linear mean of each channel of an albedo detail map: the shader multiplies by its inverse, so a
 * surface keeps its token colour on average and the photograph only adds detail to it. A texel up
 * to 1 / PBR_ALBEDO_MEAN times the mean fits.
 */
export const PBR_ALBEDO_MEAN = 0.4;

/** Channel of each quantity in a packed map: normal XY, roughness, ambient occlusion; all linear. */
export const PBR_PACKED = { normalX: 0, normalY: 1, roughness: 2, occlusion: 3 } as const;

/** The authored surfaces; each has an albedo detail map and a packed map. */
export const PBR_SURFACE_IDS = ['concrete', 'asphalt', 'pavers'] as const;

export type PbrSurface = (typeof PBR_SURFACE_IDS)[number];

/** Map roles, so a file stem is `<surface>-<role>`. */
export const PBR_ROLES = ['albedo', 'packed'] as const;

export type PbrRole = (typeof PBR_ROLES)[number];
