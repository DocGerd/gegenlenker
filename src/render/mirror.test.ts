import { Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createMirror, mirrorSamples } from './mirror';

/** Records the render targets a mirror binds; the fake accepts what three's renderer would. */
function fakeRenderer(): { gl: WebGLRenderer; bound: WebGLRenderTarget[] } {
  const bound: WebGLRenderTarget[] = [];
  const gl = {
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
  it('maps any request to the counts both backends take', () => {
    expect([0, 1, 2, 3, 4, 8].map(mirrorSamples)).toEqual([0, 0, 0, 0, 4, 4]);
  });

  it('rebuilds the target only when the effective samples change', () => {
    const { gl, bound } = fakeRenderer();
    const mirror = createMirror(4);
    const scene = new Scene();
    mirror.capture(gl, scene, 64, 32, 0);
    const first = bound[0];
    expect(first?.samples).toBe(4);
    const dispose = vi.spyOn(first as WebGLRenderTarget, 'dispose');

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
