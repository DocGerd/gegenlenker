// Imported by playwright.config.ts and e2e/perf/tablet-emulation.ts: no runtime imports, no enums.

export const WSL_LIB = '/usr/lib/wsl/lib';

/**
 * Chromium flags and environment for the real GPU on WSL2 (Mesa d3d12 behind ANGLE).
 * Headless needs EGL (`gl-egl`) and no display: with `DISPLAY` set ANGLE tries GLX and falls back to
 * SwiftShader. Headed keeps the display and desktop GL.
 */
export function wslGpuLaunch(headed: boolean): { args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['GALLIUM_DRIVER'] = 'd3d12';
  env['LD_LIBRARY_PATH'] = [WSL_LIB, env['LD_LIBRARY_PATH']].filter(Boolean).join(':');
  if (!headed) {
    delete env['DISPLAY'];
    delete env['WAYLAND_DISPLAY'];
  }
  return {
    args: ['--use-gl=angle', headed ? '--use-angle=gl' : '--use-angle=gl-egl'],
    env,
  };
}
