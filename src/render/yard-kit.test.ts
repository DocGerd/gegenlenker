import { NodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { TEXTURE_FAILED } from './texture-set';
import { KIT_SHADOW_SAMPLES, startYardKit, YARD_KIT_SHADER_MARKER } from './yard-kit';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the yard kit marker', () => {
  it('reports failed once the glb has failed twice, and not before', async () => {
    const states: (string | null)[] = [];
    const kit = startYardKit(
      (state) => states.push(state),
      () => Promise.reject(new Error('offline')),
    );
    const apply = (): void => undefined;
    kit.onLoaded(apply);
    kit.setEnabled(true);
    await settle();
    expect(states).not.toContain(TEXTURE_FAILED);
    kit.setEnabled(true);
    await settle();
    expect(states.at(-1)).toBe(TEXTURE_FAILED);
    kit.dispose();
  });
});

describe('the yard kit shadow samples', () => {
  it('build each kit material under a shadow-pass shell, the leaves with their alpha cut', () => {
    const [leaves, atlas] = KIT_SHADOW_SAMPLES.map((make) => make());
    for (const sample of [leaves, atlas]) {
      expect(sample?.override).toBeInstanceOf(NodeMaterial);
      expect(sample?.markers?.[0]).toBe(YARD_KIT_SHADER_MARKER);
    }
    expect((leaves?.mesh.material as NodeMaterial).alphaTest).toBeGreaterThan(0);
    expect(leaves?.markers).toContain('discard');
    expect(atlas?.markers).not.toContain('discard');
    leaves?.dispose();
    atlas?.dispose();
  });
});
