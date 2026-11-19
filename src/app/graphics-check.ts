import type { GraphicsBackend } from '../contracts/render';

let probe: Promise<GraphicsBackend> | null = null;

function webgl2Supported(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return false;
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (error) {
      console.warn('Could not release the WebGL probe context', error);
    }
    return true;
  } catch (error) {
    console.error('WebGL 2 probe failed', error);
    return false;
  }
}

/**
 * The backend the renderer can run on, or null for none. Probes with a throwaway context so the
 * renderer chunk is not loaded for a device that cannot run it; a success is kept for the session.
 */
export function probeGraphics(): Promise<GraphicsBackend | null> {
  if (probe === null) {
    if (!webgl2Supported()) return Promise.resolve(null);
    probe = Promise.resolve('webgl2');
  }
  return probe;
}
