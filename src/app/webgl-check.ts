let supported = false;

/** Probes with a throwaway context so the renderer chunk is not loaded for a device that cannot run it. */
export function webgl2Supported(): boolean {
  if (supported) return true;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return false;
    supported = true;
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (error) {
      console.warn('Could not release the WebGL probe context', error);
    }
  } catch (error) {
    console.warn('WebGL 2 probe failed', error);
  }
  return supported;
}
