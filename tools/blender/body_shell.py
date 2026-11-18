"""THW truck body shell for the Gegenlenker mirrors (issue #133).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/<id>.body.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH (for hosts that cannot read the path)
  OUT_PATH     where the raw .glb is written
  EXPECTED_SHA256  optional {"scriptSha256": ..., "commonSha256": ...}; the run aborts on a mismatch

One vertex-coloured mesh, "body", in the sim body frame (shell_common.py). Livery is colours only: no
lettering, emblems or maker logos. Kinds: "tipper" (three-way tipper body) and "tarp" (flatbed with
drop sides under a tarpaulin).

The shell stays inside the procedural body's footprint and out of the bands the procedural detail
owns: the yellow side marking and amber markers at the floor height, and the tail lamps on the rear face.

Tested Blender version: 5.3.0 (bpy.app.version_string is printed and recorded in the manifest).
"""

import os
import runpy

COMMON_FILE = os.path.join(os.path.dirname(__file__), "shell_common.py")
COMMON = runpy.run_path(COMMON_FILE)
Shape = COMMON["Shape"]
srgb = COMMON["srgb_to_linear"]

EPS = 1e-6
RIM = 0.06  # tipper walls carry a raised rim
RIB_WIDTH = 0.08
RIB_RELIEF = 0.05
RIB_SPACING = 0.9
STRIPE = (0.45, 0.65)  # tipper side stripe, above the floor
DROP_HEIGHT = 0.5  # tarp bed: drop sides
DROP_THICKNESS = 0.05
TARP_TOP = 2.75
TARP_SHOULDER = 0.25  # height of the tarp's slanted shoulder
TARP_INSET = 0.04  # tarp half width is the body's less this
TARP_CROWN = 0.2  # the roof is this much narrower than the walls
TARP_STRIPE = 0.22
ARCH_ANGLES = (35, 145)
ARCH_CLEARANCE = (0.06, 0.14)


def floor(p, shape, hues):
    hw = p["width"] / 2
    shape.box((p["rearX"], p["bodyFront"]), (-hw, hw), (p["frameTop"], p["floorTop"]), hues["body"])


def arches(p, shape, hues):
    hw, radius = p["width"] / 2, p["wheelRadius"]
    for side in (-1, 1):
        edge = (hw, hw + p["relief"]) if side > 0 else (-hw - p["relief"], -hw)
        shape.arch(
            (p["rearAxleX"], radius),
            (radius + ARCH_CLEARANCE[0], radius + ARCH_CLEARANCE[1]),
            ARCH_ANGLES,
            edge,
            hues["white"],
        )


def tipper(p, shape, hues):
    hw, wall = p["width"] / 2, p["wallThickness"]
    rear, front = p["rearX"], p["bodyFront"]
    z0, top = p["floorTop"], p["wallTop"]
    body = hues["body"]
    for side in (-1, 1):
        lateral = (hw - wall, hw) if side > 0 else (-hw, -hw + wall)
        shape.box((rear, front), lateral, (z0, top), body)
        rim = (hw - wall - 0.02, hw + 0.04) if side > 0 else (-hw - 0.04, -hw + wall + 0.02)
        shape.box((rear, front), rim, (top, top + RIM), body)
    shape.box((front - wall, front), (-hw + wall, hw - wall), (z0, top), body)
    shape.box((rear, rear + wall), (-hw + wall, hw - wall), (z0, top), body)
    count = max(2, round((front - rear - 0.6) / RIB_SPACING))
    stripe_z = (z0 + STRIPE[0], z0 + STRIPE[1])
    for side in (-1, 1):
        edge = (hw, hw + p["relief"]) if side > 0 else (-hw - p["relief"], -hw)
        shape.box((rear + 0.15, front - 0.15), edge, stripe_z, hues["white"])
        proud = (hw, hw + RIB_RELIEF) if side > 0 else (-hw - RIB_RELIEF, -hw)
        for i in range(count):
            x = rear + 0.3 + (front - rear - 0.6) * i / (count - 1)
            shape.box((x - RIB_WIDTH / 2, x + RIB_WIDTH / 2), proud, (z0 + 0.05, top - 0.1), body)


def tarp(p, shape, hues):
    hw = p["width"] / 2
    rear, front = p["rearX"], p["bodyFront"]
    z0 = p["floorTop"]
    deck = z0 + DROP_HEIGHT
    for side in (-1, 1):
        lateral = (hw - DROP_THICKNESS, hw) if side > 0 else (-hw, -hw + DROP_THICKNESS)
        shape.box((rear, front), lateral, (z0, deck), hues["body"])
    shape.box((front - 0.1, front), (-hw, hw), (z0, deck), hues["body"])
    wt = hw - TARP_INSET
    z1 = TARP_TOP - TARP_SHOULDER
    section = [
        (-wt, deck),
        (wt, deck),
        (wt, z1),
        (wt - TARP_CROWN, TARP_TOP),
        (-wt + TARP_CROWN, TARP_TOP),
        (-wt, z1),
    ]
    shape.prism(section, rear, front, hues["body"], frame="yz")
    for side in (-1, 1):
        edge = (wt, wt + p["relief"]) if side > 0 else (-wt - p["relief"], -wt)
        shape.box((rear + 0.05, front - 0.05), edge, (deck, deck + TARP_STRIPE), hues["white"])


def check_bands(p, shape):
    """Nothing here may share a face with what the procedural detail draws, nor leave the body."""
    hw = p["width"] / 2
    lo, hi = p["marking"]["zLow"], p["marking"]["zHigh"]
    for (x0, x1), (y0, y1), (z0, z1) in shape.extents():
        if x0 < p["rearX"] - EPS:
            raise ValueError("a face lies behind the rear face, where the tail lamps are")
        if x1 > p["bodyFront"] + EPS:
            raise ValueError("a face reaches past the body front")
        if max(abs(y0), abs(y1)) > hw + EPS and z0 < hi + EPS and z1 > lo - EPS:
            raise ValueError("a face crosses the side marking band")


def main():
    params = COMMON["load_params"](globals())
    if params["kind"] not in ("tipper", "tarp"):
        raise ValueError("unknown body kind " + repr(params["kind"]))
    hashes = COMMON["provenance"](__file__, COMMON_FILE, params)
    COMMON["check_expected"](hashes, globals().get("EXPECTED_SHA256"))
    hues = {key: srgb(value) for key, value in sorted(params["hues"].items())}

    shape = Shape()
    floor(params, shape, hues)
    arches(params, shape, hues)
    if params["kind"] == "tipper":
        tipper(params, shape, hues)
    else:
        tarp(params, shape, hues)
    check_bands(params, shape)
    return COMMON["export"](OUT_PATH, "body-shell", hashes, [("body", shape)])


RESULT = main()
