import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BODY_SHELL } from './body-dims';

const script = readFileSync(join(import.meta.dirname, '../../tools/blender/body_shell.py'), 'utf8');
const constant = (name: string): string => {
  const found = new RegExp(`^${name} = (.+?)(?:\\s+#.*)?$`, 'm').exec(script);
  if (found?.[1] === undefined) throw new Error(`body_shell.py has no ${name}`);
  return found[1];
};

describe('BODY_SHELL', () => {
  it('matches the numbers body_shell.py builds the rear stalk lamps on', () => {
    expect(Number(constant('RIM'))).toBe(BODY_SHELL.rim);
    expect(constant('POST')).toBe(`(0.12, ${BODY_SHELL.postProud})`);
    expect(Number(constant('TARP_TOP'))).toBe(BODY_SHELL.tarpTop);
    expect(Number(constant('TARP_SHOULDER'))).toBe(BODY_SHELL.tarpShoulder);
    expect(Number(constant('TARP_INSET'))).toBe(BODY_SHELL.tarpInset);
    expect(Number(constant('TARP_CROWN'))).toBe(BODY_SHELL.tarpCrown);
  });
});
