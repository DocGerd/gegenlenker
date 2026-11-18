"""THW truck body shell for the Gegenlenker mirrors (issue #133).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/<id>.body.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH (for hosts that cannot read the path)
  OUT_PATH     where the raw .glb is written
  EXPECTED_SHA256  optional {"scriptSha256": ..., "commonSha256": ...}; the run aborts on a mismatch

One vertex-coloured mesh, "body", in the sim body frame (shell_common.py). Livery is colours only: no
lettering, emblems or maker logos. Kinds: "tipper" (three-way tipper body: low drop sides, a taller
headboard, a tailgate hung from a top hinge bar, on a black subframe) and "tarp" (flatbed with drop
sides under a tarpaulin).

The shell stays inside the procedural body's footprint and out of the bands the procedural detail
owns: the yellow side marking and amber markers at the floor height, and the tail lamps on the rear
face. Both need a face of the shell to sit on.

Tested Blender version: 5.3.0 (bpy.app.version_string is printed and recorded in the manifest).
"""

import os
import runpy

COMMON_FILE = os.path.join(os.path.dirname(__file__), "shell_common.py")
COMMON = runpy.run_path(COMMON_FILE)
Shape = COMMON["Shape"]
srgb = COMMON["srgb_to_linear"]

EPS = 1e-6
# tipper
RIM = 0.06  # every wall carries a raised rim
RIB_WIDTH = 0.08
RIB_RELIEF = 0.035
RIB_SPACING = 0.9
POST = (0.12, 0.06)  # corner posts: length along the wall, and how far they stand proud
FLOOR_PLATE = 0.04
SIDE_RAIL = 0.06  # black rail under the floor edge, carrying the side marking
CROSS = (0.08, 0.07, 0.6)  # subframe crossmembers: width, depth and pitch
LAMP_BRACKET = 0.1  # depth of the rear brackets the tail lamps sit on
GATE_SET = 0.04  # the tailgate stands this far ahead of the rear face, room for its lock levers
GATE_GAP = 0.015  # seam between the tailgate and the corner posts
HINGE = (0.035, 0.03)  # hinge bar radius, and its height above the rim
LEVER = (0.03, 0.36)  # lock lever rod width and length
GUARD_CLEARANCE = (0.04, 0.09)  # rear mudguard: inner and outer radius beyond the tyre
GUARD_ANGLES = (25, 155)
GUARD_MARGIN = 0.03  # past the twin tyres on either side
# tarp
DROP_HEIGHT = 0.5  # drop sides
DROP_THICKNESS = 0.05
TARP_TOP = 2.75
TARP_SHOULDER = 0.25  # height of the tarp's slanted shoulder
TARP_INSET = 0.04  # tarp half width is the body's less this
TARP_CROWN = 0.2  # the roof is this much narrower than the walls
TARP_STRIPE = 0.22
ARCH_ANGLES = (35, 145)
ARCH_CLEARANCE = (0.06, 0.14)


def mirror(side, a, b):
    """Lateral range (a, b) measured outward from the centreline, on the side +1 (left) or -1."""
    return (a, b) if side > 0 else (-b, -a)


def floor(p, shape, hues):
    hw = p["width"] / 2
    shape.box((p["rearX"], p["bodyFront"]), (-hw, hw), (p["frameTop"], p["floorTop"]), hues["body"])


def arches(p, shape, hues):
    hw, radius = p["width"] / 2, p["wheelRadius"]
    for side in (-1, 1):
        shape.arch(
            (p["rearAxleX"], radius),
            (radius + ARCH_CLEARANCE[0], radius + ARCH_CLEARANCE[1]),
            ARCH_ANGLES,
            mirror(side, hw, hw + p["relief"]),
            hues["white"],
        )


def subframe(p, shape, hues):
    """Thin floor plate on a black subframe; the rails under its edges carry the side marking."""
    hw, rear, front = p["width"] / 2, p["rearX"], p["bodyFront"]
    black = hues["black"]
    plate_z = p["floorTop"] - FLOOR_PLATE
    shape.box((rear, front), (-hw, hw), (plate_z, p["floorTop"]), hues["body"])
    rail = p["rail"]
    for side in (-1, 1):
        shape.box((rear, front), mirror(side, hw - SIDE_RAIL, hw), (p["marking"]["zLow"] - 0.01, plate_z), black)
        reach = mirror(side, rail["halfGap"] - rail["width"] / 2 - 0.02, rail["halfGap"] + rail["width"] / 2 + 0.02)
        shape.box((rear + LAMP_BRACKET, front), reach, (p["frameTop"], plate_z), black)
        lamp = p["tailLamp"]
        inner = hw - lamp["inset"] - lamp["width"] - 0.03
        shape.box((rear, rear + LAMP_BRACKET), mirror(side, inner, hw - SIDE_RAIL), (p["frameTop"], plate_z), black)
    width, depth, pitch = CROSS
    span = front - rear - 2 * LAMP_BRACKET - width
    count = max(2, round(span / pitch) + 1)
    for i in range(count):
        x = rear + LAMP_BRACKET + span * i / (count - 1)
        shape.box((x, x + width), (-hw + SIDE_RAIL, hw - SIDE_RAIL), (plate_z - depth, plate_z), black)


def mudguards(p, shape, hues):
    """White mudguards over the rear twin tyres, as wide as the pair."""
    radius = p["wheelRadius"]
    twin = p["twin"]
    reach = twin["offset"] + twin["width"] / 2 + GUARD_MARGIN
    for side in (-1, 1):
        centre = p["rearTrack"] / 2
        shape.arch(
            (p["rearAxleX"], radius),
            (radius + GUARD_CLEARANCE[0], radius + GUARD_CLEARANCE[1]),
            GUARD_ANGLES,
            mirror(side, centre - reach, centre + reach),
            hues["white"],
        )


def tipper(p, shape, hues):
    hw, wall = p["width"] / 2, p["wallThickness"]
    rear, front = p["rearX"], p["bodyFront"]
    t = p["tipper"]
    z0, top = p["floorTop"], t["wallTop"]
    body, white, black = hues["body"], hues["white"], hues["black"]
    post_len, post_proud = POST
    inner = hw - post_len
    side_x = (rear + post_len, front - post_len)
    stripe = tuple(t["stripe"])
    if not (z0 < stripe[0] < stripe[1] < top):
        raise ValueError("the stripe does not fit on the drop sides")
    for side in (-1, 1):
        shape.box(side_x, mirror(side, hw - wall, hw), (z0, top), body)
        shape.box(side_x, mirror(side, hw - wall - 0.02, hw + 0.04), (top, top + RIM), body)
        for x in (rear, front - post_len):
            shape.box((x, x + post_len), mirror(side, inner, hw + post_proud), (z0, top + RIM), body)
        shape.box(side_x, mirror(side, hw, hw + p["relief"]), stripe, white)
        # vertical ribs end below the stripe, so it runs unbroken from post to post
        count = max(2, round((side_x[1] - side_x[0] - 0.4) / RIB_SPACING) + 1)
        for i in range(count):
            x = side_x[0] + 0.2 + (side_x[1] - side_x[0] - 0.4) * i / (count - 1)
            shape.box((x - RIB_WIDTH / 2, x + RIB_WIDTH / 2), mirror(side, hw, hw + RIB_RELIEF), (z0 + 0.04, stripe[0] - 0.03), body)
    headboard(p, shape, body)
    tailgate(p, shape, body, black)


def headboard(p, shape, body):
    """The cab guard: full width, taller than the drop sides, stiffened on its rear face."""
    hw, wall = p["width"] / 2, p["wallThickness"]
    front = p["bodyFront"]
    t = p["tipper"]
    z0, top, head = p["floorTop"], t["wallTop"], t["headboardTop"]
    back = front - wall
    shape.box((back, front), (-hw, hw), (z0, head), body)
    shape.box((back - 0.03, front), (-hw - 0.02, hw + 0.02), (head, head + RIM), body)
    for zb in (top + RIM + 0.1, (top + RIM + head) / 2 + 0.05):
        shape.box((back - 0.03, back), (-hw + POST[0], hw - POST[0]), (zb, zb + 0.04), body)
    for y in (-0.6, 0.0, 0.6):
        shape.box((back - 0.03, back), (y - 0.04, y + 0.04), (top + RIM, head), body)


def tailgate(p, shape, body, black):
    """A separate gate between the rear corner posts, hung from a black hinge bar, with lock levers."""
    hw, wall = p["width"] / 2, p["wallThickness"]
    rear = p["rearX"]
    t = p["tipper"]
    z0, top = p["floorTop"], t["wallTop"]
    edge = hw - POST[0] - GATE_GAP
    face = rear + GATE_SET
    shape.box((face, face + wall), (-edge, edge), (z0 + 0.01, top), body)
    for zb in (z0 + 0.18, (z0 + top) / 2 + 0.05):
        shape.box((face - 0.02, face), (-edge + 0.12, edge - 0.12), (zb, zb + 0.04), body)
    radius, rise = HINGE
    bar_z = top + RIM + rise
    bar_x = face + wall / 2
    shape.tube((bar_x, -hw + 0.04, bar_z), (bar_x, hw - 0.04, bar_z), radius, black)
    for y in (-edge + 0.15, 0.0, edge - 0.15):
        shape.box((bar_x - 0.02, bar_x + 0.02), (y - 0.03, y + 0.03), (top - 0.12, bar_z), black)
    rod, length = LEVER
    for side in (-1, 1):
        shape.box((face - 0.03, face), mirror(side, edge - 0.1 - rod, edge - 0.1), (z0 + 0.05, z0 + 0.05 + length), black)
        shape.box((rear, face), mirror(side, edge - 0.34, edge - 0.08), (z0 + length - 0.02, z0 + length + 0.02), black)


def tarp(p, shape, hues):
    hw = p["width"] / 2
    rear, front = p["rearX"], p["bodyFront"]
    z0 = p["floorTop"]
    deck = z0 + DROP_HEIGHT
    for side in (-1, 1):
        shape.box((rear, front), mirror(side, hw - DROP_THICKNESS, hw), (z0, deck), hues["body"])
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
        shape.box((rear + 0.05, front - 0.05), mirror(side, wt, wt + p["relief"]), (deck, deck + TARP_STRIPE), hues["white"])


def covered(intervals, lo, hi):
    """Whether the union of (a, b) intervals covers lo..hi."""
    reach = lo
    for a, b in sorted(intervals):
        if a > reach + EPS:
            return False
        reach = max(reach, b)
        if reach >= hi - EPS:
            return True
    return reach >= hi - EPS


def check_bands(p, shape):
    """Nothing may share a face with what the procedural detail draws, nor leave the body; the
    side marking and the tail lamps each keep a face to sit on."""
    hw = p["width"] / 2
    mark = p["marking"]
    lo, hi = mark["zLow"], mark["zHigh"]
    rear, front = p["rearX"], p["bodyFront"]
    for (x0, x1), (y0, y1), (z0, z1) in shape.extents():
        if x0 < rear - EPS:
            raise ValueError("a face lies behind the rear face, where the tail lamps are")
        if x1 > front + EPS:
            raise ValueError("a face reaches past the body front")
        if max(abs(y0), abs(y1)) > hw + EPS and z0 < hi + EPS and z1 > lo - EPS:
            raise ValueError("a face crosses the side marking band")
    faces = list(shape.extents())
    for side in (-1, 1):
        spans = [x for x, (y0, y1), (z0, z1) in faces if abs(y0 - side * hw) < EPS and abs(y1 - side * hw) < EPS and z0 <= lo + EPS and z1 >= hi - EPS]
        if not covered(spans, rear + mark["endMargin"], front - mark["endMargin"]):
            raise ValueError("the side marking has no face to sit on")
    lamp = p["tailLamp"]
    z_low = p["frameTop"] + lamp["sill"]
    z_high = z_low + lamp["height"]
    for side in (-1, 1):
        want = mirror(side, hw - lamp["inset"] - lamp["width"], hw - lamp["inset"])
        heights = [z for (x0, x1), (y0, y1), z in faces if abs(x0 - rear) < EPS and abs(x1 - rear) < EPS and y0 <= want[0] + EPS and y1 >= want[1] - EPS]
        if not covered(heights, z_low, z_high):
            raise ValueError("a tail lamp has no surface to sit on")


def main():
    params = COMMON["load_params"](globals())
    if params["kind"] not in ("tipper", "tarp"):
        raise ValueError("unknown body kind " + repr(params["kind"]))
    hashes = COMMON["provenance"](__file__, COMMON_FILE, params)
    COMMON["check_expected"](hashes, globals().get("EXPECTED_SHA256"))
    hues = {key: srgb(value) for key, value in sorted(params["hues"].items())}

    shape = Shape()
    if params["kind"] == "tipper":
        subframe(params, shape, hues)
        mudguards(params, shape, hues)
        tipper(params, shape, hues)
    else:
        floor(params, shape, hues)
        arches(params, shape, hues)
        tarp(params, shape, hues)
    check_bands(params, shape)
    return COMMON["export"](OUT_PATH, "body-shell", hashes, [("body", shape)])


RESULT = main()
