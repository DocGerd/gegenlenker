import { Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createMirror } from './mirror';

/** Records the render targets a mirror binds; the fake accepts what three's renderer would. */
function fakeRenderer(maxSamples: number): { gl: WebGLRenderer; bound: WebGLRenderTarget[] } {
  const bound: WebGLRenderTarget[] = [];
  const gl = {
    capabilities: { maxSamples },
    setRenderTarget: (target: WebGLRenderTarget | null) => {
      if (target !== null) bound.push(target);
    },
    setClearColor: () => undefined,
    clear: () => undefined,
    render: () => undefined,
  } as unknown as WebGLRenderer;
  return { gl, bound };
}

describe('mirror samples', () => {
  it('rebuilds the target only when the effective samples change', () => {
    const { gl, bound } = fakeRenderer(4);
    const mirror = createMirror(4);
    const scene = new Scene();
    mirror.capture(gl, scene, 64, 32, 0);
    const first = bound[0];
    expect(first?.samples).toBe(4);
    const dispose = vi.spyOn(first as WebGLRenderTarget, 'dispose');

    mirror.setSamples(4, 4);
    mirror.setSamples(8, 4);
    expect(dispose).not.toHaveBeenCalled();

    mirror.setSamples(0, 4);
    expect(dispose).toHaveBeenCalledOnce();
    mirror.capture(gl, scene, 64, 32, 0);
    expect(bound[1]).not.toBe(first);
    expect(bound[1]?.samples).toBe(0);
  });
});
