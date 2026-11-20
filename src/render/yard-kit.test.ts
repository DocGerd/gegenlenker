import { describe, expect, it } from 'vitest';
import { TEXTURE_FAILED } from './texture-set';
import { startYardKit } from './yard-kit';

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
