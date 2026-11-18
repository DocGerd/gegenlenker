import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRAILER_IDS, TRUCK_IDS } from '../../src/contracts/vehicle';
import { bodyShellParams } from '../../src/render/body-dims';
import { trailerShellParams } from '../../src/render/trailer-dims';
import { trailerById, truckById } from '../../src/vehicles/registry';
import { ROOT } from './glb-build';

/*
 * Runs the shell scripts' geometry checks outside Blender: `bpy` is a stub that raises `Reached`
 * once a script gets past the checks and starts to build the scene.
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

function runScript(name: string, params: object): string {
  return execFileSync(
    'python3',
    [
      '-I',
      '-c',
      RUNNER,
      join(ROOT, 'tools/blender', name),
      JSON.stringify(params),
      join(tmpdir(), 'shell-checks.glb'),
    ],
    { encoding: 'utf8' },
  ).trim();
}

const run = (params: object): string => runScript('trailer_shell.py', params);

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

  it('refuse a low-loader whose tail lamps rise above the lamp carrier', () => {
    const params = trailerShellParams(trailerById('hueffermann-hpa-24-81-l'));
    if (params.lowLoader === undefined) throw new Error('the Hüffermann has no low-loader deck');
    const short = { ...params, lowLoader: { ...params.lowLoader, carrierTop: 0.7 } };
    expect(run(short)).toMatch(/tail lamp has no surface/);
  });
});

describe.skipIf(!python)('trailer_shell.py low-loader checks', () => {
  const params = trailerShellParams(trailerById('hueffermann-hpa-24-81-l'));
  const deck = params.lowLoader;
  if (deck === undefined) throw new Error('the Hüffermann has no low-loader deck');

  it('refuse a side marking that has no face to sit on', () => {
    const wide = { ...params, marking: { ...params.marking, strip: 0.4 } };
    expect(run(wide)).toMatch(/side marking has no face/);
  });

  it('refuse deck breaks out of order', () => {
    const swapped = { ...params, lowLoader: { ...deck, slopeStart: deck.slopeEnd - 0.1 } };
    expect(run(swapped)).toMatch(/out of order/);
  });
});

describe.skipIf(!python)('body_shell.py geometry checks', () => {
  const body = (params: object): string => runScript('body_shell.py', params);
  const arocs = bodyShellParams(truckById('arocs-1835-ak'));

  it.each(TRUCK_IDS)('pass the params of %s', (id) => {
    expect(body(bodyShellParams(truckById(id)))).toBe('passes');
  });

  it('refuse a tail lamp above the faces at the rear', () => {
    const high = { ...arocs, tailLamp: { ...arocs.tailLamp, sill: 0.4 } };
    expect(body(high)).toMatch(/tail lamp has no surface/);
  });

  it('refuse a side marking that runs past the faces it sits on', () => {
    const long = { ...arocs, marking: { ...arocs.marking, endMargin: -0.2 } };
    expect(body(long)).toMatch(/side marking has no face/);
  });

  it('refuse a face that crosses the side marking band', () => {
    const band = { ...arocs, marking: { ...arocs.marking, zLow: 1.5, zHigh: 1.6 } };
    expect(body(band)).toMatch(/crosses the side marking band/);
  });

  it('refuse a stripe that does not fit on the drop sides', () => {
    if (arocs.tipper === undefined) throw new Error('the Arocs has no tipper');
    const high = { ...arocs, tipper: { ...arocs.tipper, stripe: [1.85, 1.95] } };
    expect(body(high)).toMatch(/stripe does not fit/);
  });
});
