// Imported by scripts/shoot-views.mjs and playwright.config.ts: no runtime imports, no enums.

/**
 * Chromium launch options for WebGPU on SwiftShader (no GPU needed). Only the new headless mode
 * (`channel: 'chromium'`) presents SwiftShader WebGPU frames; other flag sets lose the device.
 */
export const WEBGPU_LAUNCH = {
  channel: 'chromium',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ],
};
