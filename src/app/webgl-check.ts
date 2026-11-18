let supported = false;

/** Probes with a throwaway context so the renderer chunk is not loaded for a device that cannot run it. */
export function webgl2Supported(): boolean {
  if (supported) return true;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    supported = true;
  } catch {
    // A throwing probe counts as unsupported; the next start probes again.
  }
  return supported;
}
