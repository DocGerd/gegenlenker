# Asset credits

Third-party assets shipped with the app. Each entry names its source, licence, author and what was changed. CC0 needs no attribution; it is recorded anyway so every file can be traced. A CC-BY asset would also need an in-app attribution page.

The entries below are generated from `tools/assets/sources.ts` by `pnpm credits`; edit the registry, not the entries.

<!-- credits:start -->

## Yard-kit tile: `corrugated_iron_02`

- **Source:** https://polyhaven.com/a/corrugated_iron_02
- **Licence:** CC0 1.0 (https://polyhaven.com/license)
- **Authors:** Jenelle van Heerden (processing) and Sergej Majboroda (photography), Poly Haven
- **Files:**
  - https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/corrugated_iron_02/corrugated_iron_02_diff_2k.jpg
    - SHA-256: `1bd2b9900e066d7e6cbacc5093aa4204db71c1bbe13b42a3d8ad23d04fa8075a`
    - Local path: `tools/blender/input/corrugated_iron_02/corrugated_iron_02_diff_2k.jpg`
  - https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/corrugated_iron_02/corrugated_iron_02_nor_gl_2k.jpg
    - SHA-256: `a7972360f64fb44beee57750b0ad6bee1f3b64268cd9f649b5e92e1de4de0632`
    - Local path: `tools/blender/input/corrugated_iron_02/corrugated_iron_02_nor_gl_2k.jpg`
  - https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/corrugated_iron_02/corrugated_iron_02_arm_2k.jpg
    - SHA-256: `80ae7f8b9ff7521898049cb79b7cfb82a0bb95bf0cba312ffe1d0e5760f45dcb`
    - Local path: `tools/blender/input/corrugated_iron_02/corrugated_iron_02_arm_2k.jpg`
- **Outputs:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the yard kit albedo atlas, runtime-cached
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the yard kit normal, roughness and AO atlas, runtime-cached
- **Changes:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the colour map, box-filtered into the 512 × 512 cladding tile, tinted to the cladding hue.
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the normal map's x and y, the roughness and, where the set has one, the AO map, box-filtered into the same tile.
- **Rebuild:** `tools/blender/yard_kit.py` (through the blender MCP) bakes the atlases from the files above, downloaded to the git-ignored paths; it checks their SHA-256. `pnpm texture <key>` encodes the bake in `tools/blender/bake`, which is not committed; `tools/assets/textures.test.ts` fails when the committed ktx2 is stale.

## Yard-kit tile: `CorrugatedSteel007A`

- **Source:** https://ambientcg.com/a/CorrugatedSteel007A
- **Licence:** CC0 1.0 (https://docs.ambientcg.com/license/)
- **Authors:** ambientCG
- **Files:**
  - https://ambientcg.com/get?file=CorrugatedSteel007A_2K-JPG.zip
    - Archive member: `CorrugatedSteel007A_2K-JPG_Color.jpg`
    - SHA-256: `f7474cf7d802e0c8555eedc86b4c64443cf4a5306605c5ff8b8bc9fba29d8142`
    - Local path: `tools/blender/input/CorrugatedSteel007A/CorrugatedSteel007A_2K-JPG_Color.jpg`
  - https://ambientcg.com/get?file=CorrugatedSteel007A_2K-JPG.zip
    - Archive member: `CorrugatedSteel007A_2K-JPG_NormalGL.jpg`
    - SHA-256: `20765cbbb31ee9e65486521f4ba9f04f405fd81e0055468d4dabd290223fd39f`
    - Local path: `tools/blender/input/CorrugatedSteel007A/CorrugatedSteel007A_2K-JPG_NormalGL.jpg`
  - https://ambientcg.com/get?file=CorrugatedSteel007A_2K-JPG.zip
    - Archive member: `CorrugatedSteel007A_2K-JPG_Roughness.jpg`
    - SHA-256: `e1e09939fc10b251ba1daedbc701e414ade020d5851358cc54ff000065b298be`
    - Local path: `tools/blender/input/CorrugatedSteel007A/CorrugatedSteel007A_2K-JPG_Roughness.jpg`
  - https://ambientcg.com/get?file=CorrugatedSteel007A_2K-JPG.zip
    - Archive member: `CorrugatedSteel007A_2K-JPG_AmbientOcclusion.jpg`
    - SHA-256: `943b0f3452a715d0d513e7825e9211a8be29a757cc09d3d484b72b6845dd2280`
    - Local path: `tools/blender/input/CorrugatedSteel007A/CorrugatedSteel007A_2K-JPG_AmbientOcclusion.jpg`
- **Outputs:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the yard kit albedo atlas, runtime-cached
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the yard kit normal, roughness and AO atlas, runtime-cached
- **Changes:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the colour map, box-filtered into the 512 × 512 door tile, tinted to the door hue.
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the normal map's x and y, the roughness and, where the set has one, the AO map, box-filtered into the same tile.
- **Rebuild:** `tools/blender/yard_kit.py` (through the blender MCP) bakes the atlases from the files above, downloaded to the git-ignored paths; it checks their SHA-256. `pnpm texture <key>` encodes the bake in `tools/blender/bake`, which is not committed; `tools/assets/textures.test.ts` fails when the committed ktx2 is stale.

## Yard-kit tile: `concrete_floor_02`

- **Source:** https://polyhaven.com/a/concrete_floor_02
- **Licence:** CC0 1.0 (https://polyhaven.com/license)
- **Authors:** Rob Tuytel, Poly Haven
- **Files:**
  - https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/concrete_floor_02/concrete_floor_02_diff_2k.jpg
    - SHA-256: `b08a20dcb306d08ee7f4a05ec216b19b7fd37e95745998ec5f81ecedaac1f0e9`
    - Local path: `tools/blender/input/concrete_floor_02/concrete_floor_02_diff_2k.jpg`
  - https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/concrete_floor_02/concrete_floor_02_nor_gl_2k.jpg
    - SHA-256: `ce12d18f283f884f4be6f6c110f81582376049caada1e226958659d3d5fbaae1`
    - Local path: `tools/blender/input/concrete_floor_02/concrete_floor_02_nor_gl_2k.jpg`
  - https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/concrete_floor_02/concrete_floor_02_arm_2k.jpg
    - SHA-256: `bea1da529cfaf1dba9d127b8ae89793530d261f199409cdebb23abf750306c74`
    - Local path: `tools/blender/input/concrete_floor_02/concrete_floor_02_arm_2k.jpg`
- **Outputs:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the yard kit albedo atlas, runtime-cached
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the yard kit normal, roughness and AO atlas, runtime-cached
- **Changes:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the colour map, box-filtered into the 512 × 512 concrete tile, with its contrast scaled to 0.8.
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the normal map's x and y, the roughness and, where the set has one, the AO map, box-filtered into the same tile.
- **Rebuild:** `tools/blender/yard_kit.py` (through the blender MCP) bakes the atlases from the files above, downloaded to the git-ignored paths; it checks their SHA-256. `pnpm texture <key>` encodes the bake in `tools/blender/bake`, which is not committed; `tools/assets/textures.test.ts` fails when the committed ktx2 is stale.

## Yard-kit tile: `Facade001`

- **Source:** https://ambientcg.com/a/Facade001
- **Licence:** CC0 1.0 (https://docs.ambientcg.com/license/)
- **Authors:** ambientCG
- **Files:**
  - https://ambientcg.com/get?file=Facade001_2K-JPG.zip
    - Archive member: `Facade001_2K-JPG_Color.jpg`
    - SHA-256: `6a32358fd3a95f92d0779e9b0a93b1f97a640ff3d451953add5417565e1f6fef`
    - Local path: `tools/blender/input/Facade001/Facade001_2K-JPG_Color.jpg`
  - https://ambientcg.com/get?file=Facade001_2K-JPG.zip
    - Archive member: `Facade001_2K-JPG_NormalGL.jpg`
    - SHA-256: `08a50700d418a0110b5367fad7833d526258559bb693c0adc7c1a141de30343f`
    - Local path: `tools/blender/input/Facade001/Facade001_2K-JPG_NormalGL.jpg`
  - https://ambientcg.com/get?file=Facade001_2K-JPG.zip
    - Archive member: `Facade001_2K-JPG_Roughness.jpg`
    - SHA-256: `4b7e0b4aa787d20b43f476a2b233ff8518c8a8940e67ffa5feb15e533ba0c81e`
    - Local path: `tools/blender/input/Facade001/Facade001_2K-JPG_Roughness.jpg`
- **Outputs:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the yard kit albedo atlas, runtime-cached
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the yard kit normal, roughness and AO atlas, runtime-cached
- **Changes:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the colour map, box-filtered into the 256 × 256 glazing tile.
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the normal map's x and y, the roughness and, where the set has one, the AO map, box-filtered into the same tile.
- **Rebuild:** `tools/blender/yard_kit.py` (through the blender MCP) bakes the atlases from the files above, downloaded to the git-ignored paths; it checks their SHA-256. `pnpm texture <key>` encodes the bake in `tools/blender/bake`, which is not committed; `tools/assets/textures.test.ts` fails when the committed ktx2 is stale.

## Yard-kit tile: `container_side`

- **Source:** https://polyhaven.com/a/container_side
- **Licence:** CC0 1.0 (https://polyhaven.com/license)
- **Authors:** Dimitrios Savva, Poly Haven
- **Files:**
  - https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/container_side/container_side_diff_2k.jpg
    - SHA-256: `f6d88ea2c1f7e6edb3d969af5610017bc8ccf455ef45f99ba5bac60a3963fda4`
    - Local path: `tools/blender/input/container_side/container_side_diff_2k.jpg`
  - https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/container_side/container_side_nor_gl_2k.jpg
    - SHA-256: `5bf3d7b304d98bec2065ad2501926cf880e014442bd1457a6a60df79be3a4d34`
    - Local path: `tools/blender/input/container_side/container_side_nor_gl_2k.jpg`
  - https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/container_side/container_side_arm_2k.jpg
    - SHA-256: `1000abab0c63c5e755690db659550e53f6668c8bb3adf965198494578cc80e62`
    - Local path: `tools/blender/input/container_side/container_side_arm_2k.jpg`
- **Outputs:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the yard kit albedo atlas, runtime-cached
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the yard kit normal, roughness and AO atlas, runtime-cached
- **Changes:**
  - `src/render/assets/yard-kit-atlas-a.ktx2`: the colour map, box-filtered into the 256 × 256 container tile, tinted to the container hue.
  - `src/render/assets/yard-kit-atlas-b.ktx2`: the normal map's x and y, the roughness and, where the set has one, the AO map, box-filtered into the same tile.
- **Rebuild:** `tools/blender/yard_kit.py` (through the blender MCP) bakes the atlases from the files above, downloaded to the git-ignored paths; it checks their SHA-256. `pnpm texture <key>` encodes the bake in `tools/blender/bake`, which is not committed; `tools/assets/textures.test.ts` fails when the committed ktx2 is stale.

## Yard-kit leaves: `LeafSet009`

- **Source:** https://ambientcg.com/a/LeafSet009
- **Licence:** CC0 1.0 (https://docs.ambientcg.com/license/)
- **Authors:** ambientCG
- **Files:**
  - https://ambientcg.com/get?file=LeafSet009_2K-JPG.zip
    - Archive member: `LeafSet009_2K-JPG_Color.jpg`
    - SHA-256: `9423d1e0d8b06c4733f80cab5eeebf021383f81afabc941708f4d848c484601c`
    - Local path: `tools/blender/input/LeafSet009/LeafSet009_2K-JPG_Color.jpg`
  - https://ambientcg.com/get?file=LeafSet009_2K-JPG.zip
    - Archive member: `LeafSet009_2K-JPG_Opacity.jpg`
    - SHA-256: `77d41bd38c6a97797ac89f13241d7a388cf23f27e1a8db7b787bc046ea5ec969`
    - Local path: `tools/blender/input/LeafSet009/LeafSet009_2K-JPG_Opacity.jpg`
- **Outputs:**
  - `src/render/assets/yard-kit-leaves.ktx2`: the leaf cards of the yard kit trees, hedge and grass tuft, runtime-cached
- **Changes:**
  - `src/render/assets/yard-kit-leaves.ktx2`: the six leaves cut from the colour and opacity maps at 256 × 256, scattered into the lime, maple and hedge clusters and tinted to each cluster hue.
- **Rebuild:** `tools/blender/yard_kit.py` (through the blender MCP) bakes the atlases from the files above, downloaded to the git-ignored paths; it checks their SHA-256. `pnpm texture <key>` encodes the bake in `tools/blender/bake`, which is not committed; `tools/assets/textures.test.ts` fails when the committed ktx2 is stale.

## Yard-kit leaves: `Foliage001`

- **Source:** https://ambientcg.com/a/Foliage001
- **Licence:** CC0 1.0 (https://docs.ambientcg.com/license/)
- **Authors:** ambientCG
- **Files:**
  - https://ambientcg.com/get?file=Foliage001_2K-JPG.zip
    - Archive member: `Foliage001_2K-JPG_Color.jpg`
    - SHA-256: `1e95514317c34fe70189879e553fd3baa5ca8092a9d33249837ab79f7aa5bd7c`
    - Local path: `tools/blender/input/Foliage001/Foliage001_2K-JPG_Color.jpg`
  - https://ambientcg.com/get?file=Foliage001_2K-JPG.zip
    - Archive member: `Foliage001_2K-JPG_Opacity.jpg`
    - SHA-256: `7bb223b929b4f3af27306be1e88b5b3ed5a19590521d7bdd62b6b121f3cecce7`
    - Local path: `tools/blender/input/Foliage001/Foliage001_2K-JPG_Opacity.jpg`
- **Outputs:**
  - `src/render/assets/yard-kit-leaves.ktx2`: the leaf cards of the yard kit trees, hedge and grass tuft, runtime-cached
- **Changes:**
  - `src/render/assets/yard-kit-leaves.ktx2`: the colour and opacity maps box-filtered to 512 × 512 as the grass tuft card, tinted to the tuft hue.
- **Rebuild:** `tools/blender/yard_kit.py` (through the blender MCP) bakes the atlases from the files above, downloaded to the git-ignored paths; it checks their SHA-256. `pnpm texture <key>` encodes the bake in `tools/blender/bake`, which is not committed; `tools/assets/textures.test.ts` fails when the committed ktx2 is stale.

## Sky: `kloofendal_48d_partly_cloudy_puresky`

- **Source:** https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
- **Licence:** CC0 1.0 (https://polyhaven.com/license)
- **Authors:** Greg Zaal (original) and Jarod Guest (sky edits), Poly Haven
- **Files:**
  - https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/kloofendal_48d_partly_cloudy_puresky_4k.hdr
    - SHA-256: `3061c00a16ecae748e84fd6c44c04804f539c118bb66325db858bad87b11bf88`
    - Local path: `tools/textures/input/kloofendal_48d_partly_cloudy_puresky_4k.hdr`
- **Outputs:**
  - `src/render/assets/sky.ktx2`: the sky dome on High, runtime-cached
  - `src/render/hdri-light.ts`: the perspective light rig on High
- **Changes:**
  - `src/render/assets/sky.ktx2`: the upper hemisphere only, at 4096 × 1024. Texels brighter than 20× the median luminance are scaled down to it, and each channel is stored as x / (1 + x) in sRGB, encoded as UASTC KTX2 with a single level (no mipmaps).
  - `src/render/hdri-light.ts`: baked from the same `.hdr`. It holds the sun direction and irradiance, the SH9 sky radiance with the sun clamped out, and the horizon colours.
- **Rebuild:** `pnpm texture sky` (`tools/textures/sky-pixels.ts`) writes both outputs from the 4k `.hdr`, which is not committed: download it to the git-ignored path above. The build checks its SHA-256 and records its input hashes in both outputs; `tools/assets/textures.test.ts` and `tools/textures/sky-build.test.ts` fail when they are stale.

<!-- credits:end -->
