import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRAILER_IDS } from '../../src/contracts/vehicle';
import { trailerShellParams } from '../../src/render/trailer-dims';
import { trailerById } from '../../src/vehicles/registry';
import { ROOT } from './glb-build';

/*
 * Runs trailer_shell.py's geometry checks outside Blender: `bpy` is a stub that raises `Reached`
 * once the script gets past the checks and starts to build the scene.
 */
const RUNNER = `
import json, runpy, sys, types
class Reached(Exception):
    pass
bpy = types.ModuleType("bpy")
def missing(name):
    raise Reached(name)
bpy.__getattr__ = missing
sys.modules["bpy"] = bpy
try:
    runpy.run_path(sys.argv[1], init_globals={"PARAMS_JSON": sys.argv[2], "OUT_PATH": sys.argv[3]})
except Reached:
    print("passes")
except ValueError as error:
    print("ValueError: " + str(error))
`;

const python = spawnSync('python3', ['-I', '-c', 'import sys'], { encoding: 'utf8' }).status === 0;
const script = join(ROOT, 'tools/blender/trailer_shell.py');

function run(params: object): string {
  return execFileSync(
    'python3',
    ['-I', '-c', RUNNER, script, JSON.stringify(params), join(tmpdir(), 'trailer-checks.glb')],
    { encoding: 'utf8' },
  ).trim();
}

const krone = JSON.parse(
  readFileSync(join(ROOT, 'tools/blender/params/krone-azw-18.trailer.json'), 'utf8'),
) as ReturnType<typeof trailerShellParams>;

describe.skipIf(!python)('trailer_shell.py geometry checks', () => {
  it.each(TRAILER_IDS)('pass the params of %s', (id) => {
    expect(run(trailerShellParams(trailerById(id)))).toBe('passes');
  });

  it('refuse a face below the underside that crosses the underrun guard, even when it is wider than the guard', () => {
    const wide = { ...krone, track: 2.5, rearAxleXs: [-1.6] };
    expect(run(wide)).toMatch(/underrun guard/);
  });

  it('refuse a face below the underside that enters the swing of the dolly wheels', () => {
    const near = { ...krone, rearAxleXs: [5] };
    expect(run(near)).toMatch(/swing/);
  });
});
