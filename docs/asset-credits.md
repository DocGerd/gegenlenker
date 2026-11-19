# Asset credits

Third-party assets shipped with the app. Each entry names its source, licence, author and what was changed. CC0 needs no attribution; it is recorded anyway so every file can be traced. A CC-BY asset would also need an in-app attribution page.

## Sky: `kloofendal_48d_partly_cloudy_puresky`

- **Source:** https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky (4k `.hdr`)
- **Licence:** CC0 1.0 (https://polyhaven.com/license)
- **Authors:** Greg Zaal (original) and Jarod Guest (sky edits), Poly Haven
- **Files:** `src/render/assets/sky.ktx2` (the sky dome on High, runtime-cached) and `src/render/hdri-light.ts` (the perspective light rig on High).
- **Changes:**
  - `sky.ktx2`: the upper hemisphere only, at 4096 × 1024. Texels brighter than 20× the median luminance are scaled down to it, and each channel is stored as x / (1 + x) in sRGB, encoded as UASTC KTX2 with a single level (no mipmaps).
  - `hdri-light.ts`: baked from the same `.hdr`. It holds the sun direction and irradiance, the SH9 sky radiance with the sun clamped out, and the horizon colours.
- **Rebuild:** `pnpm sky:texture` (`tools/textures/sky-build.ts`) writes both files. The 4k `.hdr` is not committed: download it from https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/kloofendal_48d_partly_cloudy_puresky_4k.hdr to `tools/textures/input/` (ignored), or pass its path. The build checks its SHA-256 and records its input hashes in both outputs; `tools/textures/sky-build.test.ts` fails when they are stale.
