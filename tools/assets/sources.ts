export type SourceFile = {
  readonly url: string;
  readonly sha256: string;
  /** Where a build expects the download; not committed. */
  readonly path: string;
};

export type AssetSource = {
  readonly title: string;
  readonly page: string;
  /** SPDX identifier. */
  readonly licence: string;
  readonly licenceUrl: string;
  readonly authors: string;
  readonly files: readonly SourceFile[];
  readonly outputs: readonly { readonly path: string; readonly use: string }[];
  readonly changes: readonly { readonly output: string; readonly text: string }[];
  readonly rebuild: string;
};

/** Third-party inputs of the committed assets; `TextureAsset.sources` names these ids. */
export const ASSET_SOURCES: Readonly<Record<string, AssetSource>> = {
  'kloofendal-sky': {
    title: 'Sky: `kloofendal_48d_partly_cloudy_puresky`',
    page: 'https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky',
    licence: 'CC0-1.0',
    licenceUrl: 'https://polyhaven.com/license',
    authors: 'Greg Zaal (original) and Jarod Guest (sky edits), Poly Haven',
    files: [
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/kloofendal_48d_partly_cloudy_puresky_4k.hdr',
        sha256: '3061c00a16ecae748e84fd6c44c04804f539c118bb66325db858bad87b11bf88',
        path: 'tools/textures/input/kloofendal_48d_partly_cloudy_puresky_4k.hdr',
      },
    ],
    outputs: [
      { path: 'src/render/assets/sky.ktx2', use: 'the sky dome on High, runtime-cached' },
      { path: 'src/render/hdri-light.ts', use: 'the perspective light rig on High' },
    ],
    changes: [
      {
        output: 'src/render/assets/sky.ktx2',
        text: 'the upper hemisphere only, at 4096 × 1024. Texels brighter than 20× the median luminance are scaled down to it, and each channel is stored as x / (1 + x) in sRGB, encoded as UASTC KTX2 with a single level (no mipmaps).',
      },
      {
        output: 'src/render/hdri-light.ts',
        text: 'baked from the same `.hdr`. It holds the sun direction and irradiance, the SH9 sky radiance with the sun clamped out, and the horizon colours.',
      },
    ],
    rebuild:
      '`pnpm texture sky` (`tools/textures/sky-pixels.ts`) writes both outputs from the 4k `.hdr`, which is not committed: download it to the git-ignored path above. The build checks its SHA-256 and records its input hashes in both outputs; `tools/assets/textures.test.ts` and `tools/textures/sky-build.test.ts` fail when they are stale.',
  },
};

const LICENCE_NAMES: Readonly<Record<string, string>> = { 'CC0-1.0': 'CC0 1.0' };

/**
 * One entry per source. Only CC0 is accepted: a licence that requires attribution needs an
 * in-app attribution page first.
 */
export function creditsSection(sources: Readonly<Record<string, AssetSource>>): string {
  const entries = Object.entries(sources)
    .map(([id, source]) => {
      if (source.licence !== 'CC0-1.0') {
        throw new Error(
          `${id}: licence ${source.licence} is not CC0; add an attribution page first`,
        );
      }
      const name = LICENCE_NAMES[source.licence];
      return [
        `## ${source.title}`,
        '',
        `- **Source:** ${source.page}`,
        `- **Licence:** ${name} (${source.licenceUrl})`,
        `- **Authors:** ${source.authors}`,
        '- **Files:**',
        ...source.files.flatMap((file) => [
          `  - ${file.url}`,
          `    - SHA-256: \`${file.sha256}\``,
          `    - Local path: \`${file.path}\``,
        ]),
        '- **Outputs:**',
        ...source.outputs.map((out) => `  - \`${out.path}\`: ${out.use}`),
        '- **Changes:**',
        ...source.changes.map((change) => `  - \`${change.output}\`: ${change.text}`),
        `- **Rebuild:** ${source.rebuild}`,
      ].join('\n');
    })
    .join('\n\n');
  return `\n\n${entries}\n\n`;
}
