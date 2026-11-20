import { type Mesh, type Object3D, type RenderTarget, Scene, SRGBColorSpace } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { createMirror, mirrorSamples } from './mirror';

/** Records the render targets a mirror binds and the scenes it draws; the fake accepts what three's renderer would. */
function fakeRenderer(): { gl: WebGPURenderer; bound: RenderTarget[]; drawn: Object3D[] } {
  const bound: RenderTarget[] = [];
  const drawn: Object3D[] = [];
  const gl = {
    setRenderTarget: (target: RenderTarget | null) => {
      if (target !== null) bound.push(target);
    },
    setClearColor: () => undefined,
    clear: () => undefined,
    render: (scene: Object3D) => drawn.push(scene),
    setViewport: () => undefined,
    setScissor: () => undefined,
    setScissorTest: () => undefined,
  } as unknown as WebGPURenderer;
  return { gl, bound, drawn };
}

describe('mirror samples', () => {
  it('maps any request to the counts both backends take', () => {
    expect([0, 1, 2, 3, 4, 8].map(mirrorSamples)).toEqual([0, 0, 0, 0, 4, 4]);
  });

  it('captures into an sRGB target, so a dark reflection keeps its codes', () => {
    const { gl, bound } = fakeRenderer();
    createMirror().capture(gl, new Scene(), 64, 32, 0);
    expect(bound[0]?.texture.colorSpace).toBe(SRGBColorSpace);
  });

  it('rebuilds the target only when the effective samples change', () => {
    const { gl, bound } = fakeRenderer();
    const mirror = createMirror(4);
    const scene = new Scene();
    mirror.capture(gl, scene, 64, 32, 0);
    const first = bound[0];
    expect(first?.samples).toBe(4);
    const dispose = vi.spyOn(first as RenderTarget, 'dispose');

    mirror.setSamples(4);
    mirror.setSamples(8);
    expect(dispose).not.toHaveBeenCalled();

    mirror.setSamples(2);
    expect(dispose).toHaveBeenCalledOnce();
    mirror.capture(gl, scene, 64, 32, 0);
    expect(bound[1]).not.toBe(first);
    expect(bound[1]?.samples).toBe(0);
  });
});

describe('mirror quad', () => {
  it('flips the texture in u (a mirror) and in v (the target reads back upside down)', () => {
    const { gl, drawn } = fakeRenderer();
    createMirror().composite(gl);
    const quad = drawn[0]?.children[0] as Mesh;
    const position = quad.geometry.getAttribute('position');
    const uv = quad.geometry.getAttribute('uv');
    expect(uv.count).toBe(4);
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBe(1 - (position.getX(i) + 1) / 2);
      expect(uv.getY(i)).toBe(1 - (position.getY(i) + 1) / 2);
    }
  });
});
