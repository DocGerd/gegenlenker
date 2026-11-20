export type SourceFile = {
  readonly url: string;
  /** Set when `url` is an archive: the file inside it, which `sha256` and `path` describe. */
  readonly member?: string;
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

/** Where the yard-kit bake reads its source JPGs (`SOURCES_DIR`); not committed. */
export const KIT_INPUT_DIR = 'tools/blender/input/';

const POLY_HAVEN_LICENCE = 'https://polyhaven.com/license';
const AMBIENT_CG_LICENCE = 'https://docs.ambientcg.com/license/';

const polyHavenFiles = (id: string, hashes: Readonly<Record<string, string>>): SourceFile[] =>
  Object.entries(hashes).map(([map, sha256]) => ({
    url: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/${id}/${id}_${map}_2k.jpg`,
    sha256,
    path: `${KIT_INPUT_DIR}${id}/${id}_${map}_2k.jpg`,
  }));

const ambientCgFiles = (id: string, hashes: Readonly<Record<string, string>>): SourceFile[] =>
  Object.entries(hashes).map(([map, sha256]) => ({
    url: `https://ambientcg.com/get?file=${id}_2K-JPG.zip`,
    member: `${id}_2K-JPG_${map}.jpg`,
    sha256,
    path: `${KIT_INPUT_DIR}${id}/${id}_2K-JPG_${map}.jpg`,
  }));

const KIT_ATLAS_A = 'src/render/assets/yard-kit-atlas-a.ktx2';
const KIT_ATLAS_B = 'src/render/assets/yard-kit-atlas-b.ktx2';
const KIT_LEAVES = 'src/render/assets/yard-kit-leaves.ktx2';
const KIT_REBUILD =
  '`tools/blender/yard_kit.py` (through the blender MCP) bakes the atlases from the files above, downloaded to the git-ignored paths; it checks their SHA-256. `pnpm texture <key>` encodes the bake in `tools/blender/bake`, which is not committed; `tools/assets/textures.test.ts` fails when the committed ktx2 is stale.';

/** A yard-kit atlas tile cut from a PBR set: the colour map into the albedo atlas, the rest into the packed one. */
const kitTile = (
  title: string,
  page: string,
  licenceUrl: string,
  authors: string,
  files: SourceFile[],
  tile: string,
): AssetSource => ({
  title,
  page,
  licence: 'CC0-1.0',
  licenceUrl,
  authors,
  files,
  outputs: [
    { path: KIT_ATLAS_A, use: 'the yard kit albedo atlas, runtime-cached' },
    { path: KIT_ATLAS_B, use: 'the yard kit normal, roughness and AO atlas, runtime-cached' },
  ],
  changes: [
    {
      output: KIT_ATLAS_A,
      text: `the colour map, box-filtered into the ${tile}.`,
    },
    {
      output: KIT_ATLAS_B,
      text: `the normal map's x and y, the roughness and, where the set has one, the AO map, box-filtered into the same tile.`,
    },
  ],
  rebuild: KIT_REBUILD,
});

/** A yard-kit leaf card source: colour and opacity maps cut or scattered into the leaf atlas. */
const kitLeaves = (
  title: string,
  page: string,
  files: SourceFile[],
  text: string,
): AssetSource => ({
  title,
  page,
  licence: 'CC0-1.0',
  licenceUrl: AMBIENT_CG_LICENCE,
  authors: 'ambientCG',
  files,
  outputs: [
    {
      path: KIT_LEAVES,
      use: 'the leaf cards of the yard kit trees, hedge and grass tuft, runtime-cached',
    },
  ],
  changes: [{ output: KIT_LEAVES, text }],
  rebuild: KIT_REBUILD,
});

/** Third-party inputs of the committed assets; `TextureAsset.sources` names these ids. */
export const ASSET_SOURCES: Readonly<Record<string, AssetSource>> = {
  'corrugated-iron-02': kitTile(
    'Yard-kit tile: `corrugated_iron_02`',
    'https://polyhaven.com/a/corrugated_iron_02',
    POLY_HAVEN_LICENCE,
    'Jenelle van Heerden (processing) and Sergej Majboroda (photography), Poly Haven',
    polyHavenFiles('corrugated_iron_02', {
      diff: '1bd2b9900e066d7e6cbacc5093aa4204db71c1bbe13b42a3d8ad23d04fa8075a',
      nor_gl: 'a7972360f64fb44beee57750b0ad6bee1f3b64268cd9f649b5e92e1de4de0632',
      arm: '80ae7f8b9ff7521898049cb79b7cfb82a0bb95bf0cba312ffe1d0e5760f45dcb',
    }),
    '512 × 512 cladding tile, tinted to the cladding hue',
  ),
  'corrugated-steel-007a': kitTile(
    'Yard-kit tile: `CorrugatedSteel007A`',
    'https://ambientcg.com/a/CorrugatedSteel007A',
    AMBIENT_CG_LICENCE,
    'ambientCG',
    ambientCgFiles('CorrugatedSteel007A', {
      Color: 'f7474cf7d802e0c8555eedc86b4c64443cf4a5306605c5ff8b8bc9fba29d8142',
      NormalGL: '20765cbbb31ee9e65486521f4ba9f04f405fd81e0055468d4dabd290223fd39f',
      Roughness: 'e1e09939fc10b251ba1daedbc701e414ade020d5851358cc54ff000065b298be',
      AmbientOcclusion: '943b0f3452a715d0d513e7825e9211a8be29a757cc09d3d484b72b6845dd2280',
    }),
    '512 × 512 door tile, tinted to the door hue',
  ),
  'concrete-floor-02': kitTile(
    'Yard-kit tile: `concrete_floor_02`',
    'https://polyhaven.com/a/concrete_floor_02',
    POLY_HAVEN_LICENCE,
    'Rob Tuytel, Poly Haven',
    polyHavenFiles('concrete_floor_02', {
      diff: 'b08a20dcb306d08ee7f4a05ec216b19b7fd37e95745998ec5f81ecedaac1f0e9',
      nor_gl: 'ce12d18f283f884f4be6f6c110f81582376049caada1e226958659d3d5fbaae1',
      arm: 'bea1da529cfaf1dba9d127b8ae89793530d261f199409cdebb23abf750306c74',
    }),
    '512 × 512 concrete tile, with its contrast scaled to 0.8',
  ),
  'facade-001': kitTile(
    'Yard-kit tile: `Facade001`',
    'https://ambientcg.com/a/Facade001',
    AMBIENT_CG_LICENCE,
    'ambientCG',
    ambientCgFiles('Facade001', {
      Color: '6a32358fd3a95f92d0779e9b0a93b1f97a640ff3d451953add5417565e1f6fef',
      NormalGL: '08a50700d418a0110b5367fad7833d526258559bb693c0adc7c1a141de30343f',
      Roughness: '4b7e0b4aa787d20b43f476a2b233ff8518c8a8940e67ffa5feb15e533ba0c81e',
    }),
    '256 × 256 glazing tile',
  ),
  'container-side': kitTile(
    'Yard-kit tile: `container_side`',
    'https://polyhaven.com/a/container_side',
    POLY_HAVEN_LICENCE,
    'Dimitrios Savva, Poly Haven',
    polyHavenFiles('container_side', {
      diff: 'f6d88ea2c1f7e6edb3d969af5610017bc8ccf455ef45f99ba5bac60a3963fda4',
      nor_gl: '5bf3d7b304d98bec2065ad2501926cf880e014442bd1457a6a60df79be3a4d34',
      arm: '1000abab0c63c5e755690db659550e53f6668c8bb3adf965198494578cc80e62',
    }),
    '256 × 256 container tile, tinted to the container hue',
  ),
  'leaf-set-009': kitLeaves(
    'Yard-kit leaves: `LeafSet009`',
    'https://ambientcg.com/a/LeafSet009',
    ambientCgFiles('LeafSet009', {
      Color: '9423d1e0d8b06c4733f80cab5eeebf021383f81afabc941708f4d848c484601c',
      Opacity: '77d41bd38c6a97797ac89f13241d7a388cf23f27e1a8db7b787bc046ea5ec969',
    }),
    'the six leaves cut from the colour and opacity maps at 256 × 256, scattered into the lime, maple and hedge clusters and tinted to each cluster hue.',
  ),
  'foliage-001': kitLeaves(
    'Yard-kit leaves: `Foliage001`',
    'https://ambientcg.com/a/Foliage001',
    ambientCgFiles('Foliage001', {
      Color: '1e95514317c34fe70189879e553fd3baa5ca8092a9d33249837ab79f7aa5bd7c',
      Opacity: '7bb223b929b4f3af27306be1e88b5b3ed5a19590521d7bdd62b6b121f3cecce7',
    }),
    'the colour and opacity maps box-filtered to 512 × 512 as the grass tuft card, tinted to the tuft hue.',
  ),
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
          ...(file.member === undefined ? [] : [`    - Archive member: \`${file.member}\``]),
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
