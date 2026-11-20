import { SRGBColorSpace, UnsignedByteType, type Vector2 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { createFrame, createFrameTarget, FRAME_SAMPLES } from './frame-target';

function fakeRenderer(drawingBuffer: [number, number]) {
  const calls: string[] = [];
  const setViewport = vi.fn();
  const setScissor = vi.fn();
  const gl = {
    xr: { enabled: false },
    getDrawingBufferSize: (out: Vector2) => out.set(...drawingBuffer),
    setRenderTarget: (target: unknown) => calls.push(target === null ? 'canvas' : 'target'),
    render: () => calls.push('render'),
    setViewport,
    setScissor,
  } as unknown as WebGPURenderer;
  return { gl, calls, setViewport, setScissor };
}

describe('frame target', () => {
  it('is an 8-bit multisample target that stores sRGB codes', () => {
    const target = createFrameTarget();
    expect(target.texture.type).toBe(UnsignedByteType);
    expect(target.texture.colorSpace).toBe(SRGBColorSpace);
    expect(target.samples).toBe(FRAME_SAMPLES);
    expect(target.depthBuffer).toBe(true);
  });

  it('follows the canvas drawing buffer, resizing only when it changed', () => {
    const buffer: [number, number] = [640, 360];
    const { gl } = fakeRenderer(buffer);
    const frame = createFrame(gl);
    frame.resize();
    expect([frame.target.width, frame.target.height]).toEqual([640, 360]);
    const dispose = vi.spyOn(frame.target, 'dispose');
    frame.resize();
    expect(dispose).not.toHaveBeenCalled();
    buffer[0] = 1280;
    frame.resize();
    expect([frame.target.width, frame.target.height]).toEqual([1280, 360]);
  });

  it('holds the view and scissor itself, in device px, because the renderer ignores its own for a target', () => {
    const { gl, setViewport, setScissor } = fakeRenderer([640, 360]);
    const frame = createFrame(gl);
    frame.place({ x: 10, y: 20, width: 100, height: 50 }, 2);
    expect(frame.target.viewport.toArray()).toEqual([20, 40, 200, 100]);
    expect(frame.target.scissor.toArray()).toEqual([20, 40, 200, 100]);
    expect(frame.target.scissorTest).toBe(true);
    expect(setViewport).not.toHaveBeenCalled();
    expect(setScissor).not.toHaveBeenCalled();
  });

  it('draws the target to the canvas with one output pass', () => {
    const { gl, calls } = fakeRenderer([640, 360]);
    const frame = createFrame(gl);
    frame.present();
    expect(calls).toEqual(['canvas', 'render']);
  });
});
