import { expect, test } from '../fixtures';
import { ATTACHMENTS } from '../../src/render/asset-registry';
import { GROUND_SHADER_MARKER } from '../../src/render/ground-texture-spec';
import { SKY_SHADER_MARKER } from '../../src/render/sky';
import {
  distinctColours,
  MIN_DRAWN_COLOURS,
  PRESET_TIMEOUT_MS,
  shoot,
  startPinnedDrive,
  WEBGPU_SETTLE_DEADLINE_MS,
} from '../pinned-shoot';
import { exerciseEntry } from '../menu-flow';

/** Runs in the page before the app: WGSL that holds `marker` no longer parses, whoever creates the module. */
function corruptModules(marker: string): void {
  const create = Object.getOwnPropertyDescriptor(GPUDevice.prototype, 'createShaderModule')
    ?.value as GPUDevice['createShaderModule'] | undefined;
  if (create === undefined) throw new Error('no createShaderModule to wrap');
  GPUDevice.prototype.createShaderModule = function (
    this: GPUDevice,
    descriptor: GPUShaderModuleDescriptor,
  ): GPUShaderModule {
    const broken = descriptor.code.includes(marker);
    return create.call(
      this,
      broken ? { ...descriptor, code: `${descriptor.code}\n@@@` } : descriptor,
    );
  };
}

/** `dependent`: the marker that stays unset, for that attachment only draws over the failed one. */
const CASES = [
  { name: 'sky', shader: SKY_SHADER_MARKER, attachment: ATTACHMENTS.sky, dependent: null },
  {
    name: 'ground texture',
    shader: GROUND_SHADER_MARKER,
    attachment: ATTACHMENTS.ground,
    dependent: ATTACHMENTS.groundPbr.marker,
  },
] as const;

// three logs a module the GPU rejects, and the pipeline built from it, as errors.
const REJECTED = [
  /Error while parsing WGSL/,
  /THREE\.WebGPURenderer: (Async r|R)ender pipeline creation failed \(.*\): \[Invalid ShaderModule/,
  /THREE\.WebGPURenderer \[.* \/ fragment error\]/,
];

for (const { name, shader, attachment, dependent } of CASES) {
  test(`WGSL the GPU rejects fails the ${name} and keeps the app drawing`, async ({
    page,
    allow,
  }) => {
    test.setTimeout(PRESET_TIMEOUT_MS.high + 2 * 2 * WEBGPU_SETTLE_DEADLINE_MS.high);
    for (const pattern of REJECTED) allow(pattern);
    await page.addInitScript(corruptModules, shader);
    await startPinnedDrive(
      page,
      { preset: 'high', lighting: 'day' },
      exerciseEntry('straight-reverse'),
      '?backend=webgpu',
      undefined,
      {
        [attachment.marker]: (v) => v === 'failed',
        ...(dependent === null ? {} : { [dependent]: (v) => v === '' }),
      },
    );

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-render-backend', 'webgpu');
    await expect(html).not.toHaveAttribute('data-render-fallback');
    expect(await distinctColours(page, await shoot(page, 'cockpit'))).toBeGreaterThan(
      MIN_DRAWN_COLOURS,
    );
  });
}
