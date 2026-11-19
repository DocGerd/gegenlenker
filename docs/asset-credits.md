# Asset credits

Third-party assets shipped with the app. Each entry names its source, licence, author and what was changed. CC0 needs no attribution; it is recorded anyway so every file can be traced. A CC-BY asset would also need an in-app attribution page.

## Sky: `kloofendal_48d_partly_cloudy_puresky`

- **Source:** https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky (4k `.hdr`)
- **Licence:** CC0 1.0 (https://polyhaven.com/license)
- **Authors:** Greg Zaal (original) and Jarod Guest (sky edits), Poly Haven
- **Files:** `src/render/assets/sky.ktx2` (the sky dome on High, runtime-cached) and `src/render/hdri-light.ts` (the perspective light rig on Balanced and High).
- **Changes:**
  - `sky.ktx2`: the upper hemisphere only, at 4096 × 1024. Texels brighter than 20× the median luminance are scaled down to it, and each channel is stored as x / (1 + x) in sRGB, encoded as UASTC KTX2 without mipmaps.
  - `hdri-light.ts`: baked from the same `.hdr` with `node tools/textures/hdri-light.ts <4k.hdr> src/render/assets/sky.ktx2`. It holds the sun direction and irradiance, the SH9 sky radiance with the sun clamped out, and the horizon colours. The source and sky hashes are recorded in the file.
