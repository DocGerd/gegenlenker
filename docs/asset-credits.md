# Asset credits

Third-party assets shipped with the app. Each entry names its source, licence, author and what was changed. CC0 needs no attribution; it is recorded anyway so every file can be traced. A CC-BY asset would also need an in-app attribution page.

The entries below are generated from `tools/assets/sources.ts` by `pnpm credits`; edit the registry, not the entries.

<!-- credits:start -->

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

## Yard concrete: `brushed_concrete`

- **Source:** https://polyhaven.com/a/brushed_concrete
- **Licence:** CC0 1.0 (https://polyhaven.com/license)
- **Authors:** Dario Barresi (processing) and Dimitrios Savva (photography), Poly Haven
- **Files:**
  - https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/brushed_concrete/brushed_concrete_diff_2k.png
    - SHA-256: `f225b2599f94767c2f448f9da4670788fec3604eee70e4767c5ccaafb1f79d27`
    - Local path: `tools/textures/input/brushed_concrete/brushed_concrete_diff_2k.png`
  - https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/brushed_concrete/brushed_concrete_nor_gl_2k.png
    - SHA-256: `f064f553c6357c0faa80cd7cc1253854905d24f06f3bfbe26ffdb79606e72024`
    - Local path: `tools/textures/input/brushed_concrete/brushed_concrete_nor_gl_2k.png`
  - https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/brushed_concrete/brushed_concrete_arm_2k.png
    - SHA-256: `f71461f5ce1362138832d6d335cea8679487768b461ed7578f63bdb97cde6889`
    - Local path: `tools/textures/input/brushed_concrete/brushed_concrete_arm_2k.png`
- **Outputs:**
  - `src/render/assets/concrete-albedo.ktx2`: the albedo detail of the yard on High, runtime-cached
  - `src/render/assets/concrete-packed.ktx2`: the normal, roughness and occlusion of the yard on High, runtime-cached
- **Changes:**
  - `src/render/assets/concrete-albedo.ktx2`: the 2K diffuse map with each channel divided by its own mean and scaled to a linear mean of 0.4, so only its variation remains, encoded as ETC1S sRGB KTX2 with mipmaps.
  - `src/render/assets/concrete-packed.ktx2`: the OpenGL normal map's X and Y, the roughness (green) and the ambient occlusion (red) of the AO / roughness / metalness map packed into the four channels of one linear texture, encoded as UASTC KTX2 with mipmaps. The normal's Z is rebuilt in the shader.
- **Rebuild:** `pnpm texture concrete-albedo` and `pnpm texture concrete-packed` (`tools/textures/pbr-build.ts`) read the three 2K PNGs, which are not committed: download them to the git-ignored paths above. The build checks their SHA-256 and records its input hashes in both outputs; `tools/assets/textures.test.ts` fails when they are stale.

## Street asphalt: `asphalt_02`

- **Source:** https://polyhaven.com/a/asphalt_02
- **Licence:** CC0 1.0 (https://polyhaven.com/license)
- **Authors:** Rob Tuytel, Poly Haven
- **Files:**
  - https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/asphalt_02/asphalt_02_diff_2k.png
    - SHA-256: `0f33cc1f8142bc1c19858b95f694dbf3a7be99a3c385462b1729cf65804af1d3`
    - Local path: `tools/textures/input/asphalt_02/asphalt_02_diff_2k.png`
  - https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/asphalt_02/asphalt_02_nor_gl_2k.png
    - SHA-256: `f96c0a1664e556d233b3f76e8f70ab08af5b1c342786efb99b72b8854563440e`
    - Local path: `tools/textures/input/asphalt_02/asphalt_02_nor_gl_2k.png`
  - https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/asphalt_02/asphalt_02_arm_2k.png
    - SHA-256: `d55172b4aeb248cb85742321125d608b7da5f09d26328c55735e88fa7c483129`
    - Local path: `tools/textures/input/asphalt_02/asphalt_02_arm_2k.png`
- **Outputs:**
  - `src/render/assets/asphalt-albedo.ktx2`: the albedo detail of the street on High, runtime-cached
  - `src/render/assets/asphalt-packed.ktx2`: the normal, roughness and occlusion of the street on High, runtime-cached
- **Changes:**
  - `src/render/assets/asphalt-albedo.ktx2`: the 2K diffuse map with each channel divided by its own mean and scaled to a linear mean of 0.4, so only its variation remains, encoded as ETC1S sRGB KTX2 with mipmaps.
  - `src/render/assets/asphalt-packed.ktx2`: the OpenGL normal map's X and Y, the roughness (green) and the ambient occlusion (red) of the AO / roughness / metalness map packed into the four channels of one linear texture, encoded as UASTC KTX2 with mipmaps. The normal's Z is rebuilt in the shader.
- **Rebuild:** `pnpm texture asphalt-albedo` and `pnpm texture asphalt-packed` (`tools/textures/pbr-build.ts`) read the three 2K PNGs, which are not committed: download them to the git-ignored paths above. The build checks their SHA-256 and records its input hashes in both outputs; `tools/assets/textures.test.ts` fails when they are stale.

## Pavement pavers: `concrete_pavers_02`

- **Source:** https://polyhaven.com/a/concrete_pavers_02
- **Licence:** CC0 1.0 (https://polyhaven.com/license)
- **Authors:** Amal Kumar, Poly Haven
- **Files:**
  - https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/concrete_pavers_02/concrete_pavers_02_diff_2k.png
    - SHA-256: `02ef1c1141bda595947876e2bfd35f3a4c62338c1cd535f0c141c4cd2d328417`
    - Local path: `tools/textures/input/concrete_pavers_02/concrete_pavers_02_diff_2k.png`
  - https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/concrete_pavers_02/concrete_pavers_02_nor_gl_2k.png
    - SHA-256: `f5a1b7f90b18e1d4f1b39a70fc9721e40147b618e72e68f18ad94d3c2eb7be85`
    - Local path: `tools/textures/input/concrete_pavers_02/concrete_pavers_02_nor_gl_2k.png`
  - https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/concrete_pavers_02/concrete_pavers_02_arm_2k.png
    - SHA-256: `cbb9c33e1a517375be7a071b9ce1b0d5baa403798ed21da4b5676d0dec223aa0`
    - Local path: `tools/textures/input/concrete_pavers_02/concrete_pavers_02_arm_2k.png`
- **Outputs:**
  - `src/render/assets/pavers-albedo.ktx2`: the albedo detail of the pavement on High, runtime-cached
  - `src/render/assets/pavers-packed.ktx2`: the normal, roughness and occlusion of the pavement on High, runtime-cached
- **Changes:**
  - `src/render/assets/pavers-albedo.ktx2`: the 2K diffuse map with each channel divided by its own mean and scaled to a linear mean of 0.4, so only its variation remains, encoded as ETC1S sRGB KTX2 with mipmaps.
  - `src/render/assets/pavers-packed.ktx2`: the OpenGL normal map's X and Y, the roughness (green) and the ambient occlusion (red) of the AO / roughness / metalness map packed into the four channels of one linear texture, encoded as UASTC KTX2 with mipmaps. The normal's Z is rebuilt in the shader.
- **Rebuild:** `pnpm texture pavers-albedo` and `pnpm texture pavers-packed` (`tools/textures/pbr-build.ts`) read the three 2K PNGs, which are not committed: download them to the git-ignored paths above. The build checks their SHA-256 and records its input hashes in both outputs; `tools/assets/textures.test.ts` fails when they are stale.

<!-- credits:end -->
