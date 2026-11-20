import {
  NearestFilter,
  RenderTarget,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
} from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { texture } from 'three/tsl';
import type { Rect } from '../contracts/render';

/** WebGPU takes 1 or 4 samples and WebGL 2 guarantees at least 4. */
export const FRAME_SAMPLES = 4;

/**
 * The 8-bit multisample target every pane is drawn into. It stores sRGB codes (the hardware encodes on
 * write and decodes on sample), so darks keep codes a linear 8-bit buffer would lose. Its own colour
 * space also keeps three from adding a second output pass per pane. Never per preset: the top-down
 * view must not depend on it.
 */
export function createFrameTarget(): RenderTarget {
  return new RenderTarget(1, 1, {
    type: UnsignedByteType,
    format: RGBAFormat,
    colorSpace: SRGBColorSpace,
    samples: FRAME_SAMPLES,
    depthBuffer: true,
    // nothing samples the depth, so the multisample resolve may skip it
    resolveDepthBuffer: false,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
  });
}

/**
 * The frame target and the one output pass that draws it to the canvas. `place` takes CSS px rects
 * from the top left: three ignores `renderer.setViewport` for a render target, so the target holds its
 * own viewport and scissor, in device px.
 */
export function createFrame(renderer: WebGPURenderer) {
  const target = createFrameTarget();
  const pipeline = new RenderPipeline(renderer, texture(target.texture));
  const size = new Vector2();
  return {
    target,
    /** Matches the canvas's drawing buffer, so the output pass is one texel per pixel. */
    resize(): void {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
    },
    place(rect: Rect, pixelRatio: number): void {
      target.viewport.set(
        rect.x * pixelRatio,
        rect.y * pixelRatio,
        rect.width * pixelRatio,
        rect.height * pixelRatio,
      );
      target.scissor.copy(target.viewport);
      target.scissorTest = true;
    },
    /** Draws the target to the canvas; leaves the canvas bound. */
    present(): void {
      renderer.setRenderTarget(null);
      pipeline.render();
    },
    dispose(): void {
      pipeline.dispose();
      target.dispose();
    },
  };
}

export type Frame = ReturnType<typeof createFrame>;
