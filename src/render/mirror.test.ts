import {
  MathUtils,
  type Mesh,
  type Object3D,
  type RenderTarget,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { CLASS_II_LEFT, createMirror, type MirrorSpec, mirrorSamples } from './mirror';

/** Records the render targets a mirror binds and the scenes it draws; the fake accepts what three's renderer would. */
function fakeRenderer(): {
  gl: WebGPURenderer;
  bound: RenderTarget[];
  drawn: Object3D[];
  clearedWith: boolean[];
} {
  const bound: RenderTarget[] = [];
  const drawn: Object3D[] = [];
  const clearedWith: boolean[] = [];
  const gl = {
    autoClear: false,
    setRenderTarget: (target: RenderTarget | null) => {
      if (target !== null) bound.push(target);
    },
    setClearColor: () => undefined,
    clear: () => undefined,
    render: (scene: Object3D) => {
      drawn.push(scene);
      clearedWith.push(gl.autoClear);
    },
    setViewport: () => undefined,
    setScissor: () => undefined,
    setScissorTest: () => undefined,
  } as unknown as WebGPURenderer;
  return { gl, bound, drawn, clearedWith };
}

describe('mirror samples', () => {
  it('maps any request to the counts both backends take', () => {
    expect([0, 1, 2, 3, 4, 8].map(mirrorSamples)).toEqual([0, 0, 0, 0, 4, 4]);
  });

  it('captures into an sRGB target, so a dark reflection keeps its codes', () => {
    const { gl, bound } = fakeRenderer();
    createMirror().capture(gl, new Scene(), 64, 32, 0, 0);
    expect(bound[0]?.texture.colorSpace).toBe(SRGBColorSpace);
  });

  it('clears inside the capture pass, so the multisample target resolves once', () => {
    const { gl, clearedWith } = fakeRenderer();
    createMirror().capture(gl, new Scene(), 64, 32, 0, 0);
    expect(clearedWith).toEqual([true]);
    expect(gl.autoClear).toBe(false);
  });

  it('rebuilds the target only when the effective samples change', () => {
    const { gl, bound } = fakeRenderer();
    const mirror = createMirror(CLASS_II_LEFT, 4);
    const scene = new Scene();
    mirror.capture(gl, scene, 64, 32, 0, 0);
    const first = bound[0];
    expect(first?.samples).toBe(4);
    const dispose = vi.spyOn(first as RenderTarget, 'dispose');

    mirror.setSamples(4);
    mirror.setSamples(8);
    expect(dispose).not.toHaveBeenCalled();

    mirror.setSamples(2);
    expect(dispose).toHaveBeenCalledOnce();
    mirror.capture(gl, scene, 64, 32, 0, 0);
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

describe('mirror spec', () => {
  const spec = (over: Partial<MirrorSpec>): MirrorSpec => ({ ...CLASS_II_LEFT, ...over });

  it('captures on its parity, and always when its target is missing or resized', () => {
    const { gl, drawn } = fakeRenderer();
    const mirror = createMirror(spec({ cadence: 2, parity: 1 }));
    const scene = new Scene();
    const capture = (frame: number, w = 64): boolean => mirror.capture(gl, scene, w, 32, 0, frame);

    expect(capture(0)).toBe(true);
    expect(capture(2)).toBe(false);
    expect(capture(3)).toBe(true);
    expect(capture(4)).toBe(false);
    expect(capture(4, 80)).toBe(true);
    expect(drawn).toHaveLength(3);
  });

  it('captures off its parity after a change of samples, not after an unchanged request', () => {
    const { gl } = fakeRenderer();
    const mirror = createMirror(spec({ cadence: 2, parity: 1 }), 4);
    const scene = new Scene();
    mirror.capture(gl, scene, 64, 32, 0, 1);

    mirror.setSamples(8);
    expect(mirror.capture(gl, scene, 64, 32, 0, 2)).toBe(false);
    mirror.setSamples(1);
    expect(mirror.capture(gl, scene, 64, 32, 0, 2)).toBe(true);
  });

  it('captures off its parity once invalidated', () => {
    const { gl } = fakeRenderer();
    const mirror = createMirror(spec({ cadence: 2, parity: 1 }));
    const scene = new Scene();
    mirror.capture(gl, scene, 64, 32, 0, 1);

    expect(mirror.capture(gl, scene, 64, 32, 0, 2)).toBe(false);
    mirror.invalidate();
    expect(mirror.capture(gl, scene, 64, 32, 0, 2)).toBe(true);
    expect(mirror.capture(gl, scene, 64, 32, 0, 4)).toBe(false);
  });

  it('rejects a parity the cadence never reaches', () => {
    expect(() => createMirror(spec({ cadence: 1, parity: 1 }))).toThrow();
  });

  it('applies roll, pitch and field of view to the camera, and scales the target', () => {
    const { gl, bound } = fakeRenderer();
    const mirror = createMirror(
      spec({ roll: Math.PI, pitch: 0.1, fov: 70, aspect: 2, targetScale: 0.5 }),
    );
    mirror.place(new Vector3(), 0);
    mirror.capture(gl, new Scene(), 64, 48, 0, 0);
    expect(mirror.camera.rotation.z).toBe(Math.PI);
    expect(mirror.camera.rotation.x).toBe(0.1);
    expect(mirror.camera.fov).toBe(70);
    expect(mirror.camera.aspect).toBe(2);
    expect([bound[0]?.width, bound[0]?.height]).toEqual([32, 24]);
  });

  it('keeps the class II camera unrolled and following its target', () => {
    const { gl } = fakeRenderer();
    const mirror = createMirror();
    mirror.place(new Vector3(), 0);
    mirror.capture(gl, new Scene(), 64, 48, 0, 0);
    expect(mirror.camera.rotation.z).toBe(0);
    expect(mirror.camera.rotation.x).toBe(MathUtils.degToRad(-8));
    expect(mirror.camera.fov).toBe(46);
    expect(mirror.camera.aspect).toBeCloseTo(4 / 3);
  });
});
