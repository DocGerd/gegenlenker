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
  'polyhaven-brushed-concrete': {
    title: 'Yard concrete: `brushed_concrete`',
    page: 'https://polyhaven.com/a/brushed_concrete',
    licence: 'CC0-1.0',
    licenceUrl: 'https://polyhaven.com/license',
    authors: 'Dario Barresi (processing) and Dimitrios Savva (photography), Poly Haven',
    files: [
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/brushed_concrete/brushed_concrete_diff_2k.png',
        sha256: 'f225b2599f94767c2f448f9da4670788fec3604eee70e4767c5ccaafb1f79d27',
        path: 'tools/textures/input/brushed_concrete/brushed_concrete_diff_2k.png',
      },
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/brushed_concrete/brushed_concrete_nor_gl_2k.png',
        sha256: 'f064f553c6357c0faa80cd7cc1253854905d24f06f3bfbe26ffdb79606e72024',
        path: 'tools/textures/input/brushed_concrete/brushed_concrete_nor_gl_2k.png',
      },
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/brushed_concrete/brushed_concrete_arm_2k.png',
        sha256: 'f71461f5ce1362138832d6d335cea8679487768b461ed7578f63bdb97cde6889',
        path: 'tools/textures/input/brushed_concrete/brushed_concrete_arm_2k.png',
      },
    ],
    outputs: [
      {
        path: 'src/render/assets/concrete-albedo.ktx2',
        use: 'the albedo detail of the yard on High, runtime-cached',
      },
      {
        path: 'src/render/assets/concrete-packed.ktx2',
        use: 'the normal, roughness and occlusion of the yard on High, runtime-cached',
      },
    ],
    changes: [
      {
        output: 'src/render/assets/concrete-albedo.ktx2',
        text: 'the 2K diffuse map with each channel divided by its own mean and scaled to a linear mean of 0.4, so only its variation remains, encoded as ETC1S sRGB KTX2 with mipmaps.',
      },
      {
        output: 'src/render/assets/concrete-packed.ktx2',
        text: "the OpenGL normal map's X and Y, the roughness (green) and the ambient occlusion (red) of the AO / roughness / metalness map packed into the four channels of one linear texture, encoded as UASTC KTX2 with mipmaps. The normal's Z is rebuilt in the shader.",
      },
    ],
    rebuild:
      '`pnpm texture concrete-albedo` and `pnpm texture concrete-packed` (`tools/textures/pbr-build.ts`) read the three 2K PNGs, which are not committed: download them to the git-ignored paths above. The build checks their SHA-256 and records its input hashes in both outputs; `tools/assets/textures.test.ts` fails when they are stale.',
  },
  'polyhaven-asphalt-02': {
    title: 'Street asphalt: `asphalt_02`',
    page: 'https://polyhaven.com/a/asphalt_02',
    licence: 'CC0-1.0',
    licenceUrl: 'https://polyhaven.com/license',
    authors: 'Rob Tuytel, Poly Haven',
    files: [
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/asphalt_02/asphalt_02_diff_2k.png',
        sha256: '0f33cc1f8142bc1c19858b95f694dbf3a7be99a3c385462b1729cf65804af1d3',
        path: 'tools/textures/input/asphalt_02/asphalt_02_diff_2k.png',
      },
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/asphalt_02/asphalt_02_nor_gl_2k.png',
        sha256: 'f96c0a1664e556d233b3f76e8f70ab08af5b1c342786efb99b72b8854563440e',
        path: 'tools/textures/input/asphalt_02/asphalt_02_nor_gl_2k.png',
      },
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/asphalt_02/asphalt_02_arm_2k.png',
        sha256: 'd55172b4aeb248cb85742321125d608b7da5f09d26328c55735e88fa7c483129',
        path: 'tools/textures/input/asphalt_02/asphalt_02_arm_2k.png',
      },
    ],
    outputs: [
      {
        path: 'src/render/assets/asphalt-albedo.ktx2',
        use: 'the albedo detail of the street on High, runtime-cached',
      },
      {
        path: 'src/render/assets/asphalt-packed.ktx2',
        use: 'the normal, roughness and occlusion of the street on High, runtime-cached',
      },
    ],
    changes: [
      {
        output: 'src/render/assets/asphalt-albedo.ktx2',
        text: 'the 2K diffuse map with each channel divided by its own mean and scaled to a linear mean of 0.4, so only its variation remains, encoded as ETC1S sRGB KTX2 with mipmaps.',
      },
      {
        output: 'src/render/assets/asphalt-packed.ktx2',
        text: "the OpenGL normal map's X and Y, the roughness (green) and the ambient occlusion (red) of the AO / roughness / metalness map packed into the four channels of one linear texture, encoded as UASTC KTX2 with mipmaps. The normal's Z is rebuilt in the shader.",
      },
    ],
    rebuild:
      '`pnpm texture asphalt-albedo` and `pnpm texture asphalt-packed` (`tools/textures/pbr-build.ts`) read the three 2K PNGs, which are not committed: download them to the git-ignored paths above. The build checks their SHA-256 and records its input hashes in both outputs; `tools/assets/textures.test.ts` fails when they are stale.',
  },
  'polyhaven-concrete-pavers-02': {
    title: 'Pavement pavers: `concrete_pavers_02`',
    page: 'https://polyhaven.com/a/concrete_pavers_02',
    licence: 'CC0-1.0',
    licenceUrl: 'https://polyhaven.com/license',
    authors: 'Amal Kumar, Poly Haven',
    files: [
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/concrete_pavers_02/concrete_pavers_02_diff_2k.png',
        sha256: '02ef1c1141bda595947876e2bfd35f3a4c62338c1cd535f0c141c4cd2d328417',
        path: 'tools/textures/input/concrete_pavers_02/concrete_pavers_02_diff_2k.png',
      },
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/concrete_pavers_02/concrete_pavers_02_nor_gl_2k.png',
        sha256: 'f5a1b7f90b18e1d4f1b39a70fc9721e40147b618e72e68f18ad94d3c2eb7be85',
        path: 'tools/textures/input/concrete_pavers_02/concrete_pavers_02_nor_gl_2k.png',
      },
      {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/concrete_pavers_02/concrete_pavers_02_arm_2k.png',
        sha256: 'cbb9c33e1a517375be7a071b9ce1b0d5baa403798ed21da4b5676d0dec223aa0',
        path: 'tools/textures/input/concrete_pavers_02/concrete_pavers_02_arm_2k.png',
      },
    ],
    outputs: [
      {
        path: 'src/render/assets/pavers-albedo.ktx2',
        use: 'the albedo detail of the pavement on High, runtime-cached',
      },
      {
        path: 'src/render/assets/pavers-packed.ktx2',
        use: 'the normal, roughness and occlusion of the pavement on High, runtime-cached',
      },
    ],
    changes: [
      {
        output: 'src/render/assets/pavers-albedo.ktx2',
        text: 'the 2K diffuse map with each channel divided by its own mean and scaled to a linear mean of 0.4, so only its variation remains, encoded as ETC1S sRGB KTX2 with mipmaps.',
      },
      {
        output: 'src/render/assets/pavers-packed.ktx2',
        text: "the OpenGL normal map's X and Y, the roughness (green) and the ambient occlusion (red) of the AO / roughness / metalness map packed into the four channels of one linear texture, encoded as UASTC KTX2 with mipmaps. The normal's Z is rebuilt in the shader.",
      },
    ],
    rebuild:
      '`pnpm texture pavers-albedo` and `pnpm texture pavers-packed` (`tools/textures/pbr-build.ts`) read the three 2K PNGs, which are not committed: download them to the git-ignored paths above. The build checks their SHA-256 and records its input hashes in both outputs; `tools/assets/textures.test.ts` fails when they are stale.',
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
