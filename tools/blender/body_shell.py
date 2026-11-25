"""THW truck body shell for the Gegenlenker mirrors (issue #133).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/<id>.body.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH (for hosts that cannot read the path)
  OUT_PATH     where the raw .glb is written
  EXPECTED_SHA256  optional {"scriptSha256": ..., "commonSha256": ..., "lampCommonSha256": ...}; the run aborts on a mismatch

One vertex-coloured mesh, "body", in the sim body frame (blender_common.py). Livery is colours only: no
lettering, emblems or maker logos. Kinds: "tipper" (three-way tipper body: low drop sides with
horizontal profiles, a taller headboard, a tailgate hung from a top hinge bar with a red contour, a
ladder at a rear corner, on a black subframe over black mudguards; an aluminium box and a tank on the
chassis) and "tarp" (flatbed with drop sides under a boxy tarpaulin, rear corner posts with warning
stripes, white half wings over single tyres; a tank, battery box and spare wheel on the chassis).
`rearTyres` gives the tyres each mudguard covers.

The shell stays inside the procedural body's footprint and out of the bands the procedural detail
owns: the yellow side marking and amber markers at the floor height, and the lamps on the rear face.
The marking and the detail's lamps (`mounts`, src/render/lamp-layout.ts) need a face of the shell to
sit on.

Tested Blender version: 5.3.0 (bpy.app.version_string is printed and recorded in the manifest).
"""

import os
import runpy

HERE = os.path.dirname(__file__)
COMMON_FILE = os.path.join(HERE, "blender_common.py")
LAMP_FILE = os.path.join(HERE, "lamp_common.py")
COMMON = runpy.run_path(COMMON_FILE)
LAMP = runpy.run_path(LAMP_FILE)
Shape = COMMON["Shape"]
srgb = COMMON["srgb_to_linear"]

EPS = 1e-6
# tipper
RIM = 0.06  # every wall carries a raised rim
PROFILES = (0.14, 0.29)  # horizontal profiles on the drop sides, above the floor
PROFILE = (0.05, 0.035)  # their height and how far they stand proud
STRIPE_LINE = (0.03, 0.02)  # thin line and gap at the stripe's foot, as on the cab
LADDER = (0.3, 0.035, 0.025, 0.6)  # rail spacing, rail section, how far proud, foot above the ground
RUNG_PITCH = 0.25
CONTOUR = 0.06  # red rear contour on the tailgate (ECE R48 asks at least 50 mm)
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
GUARD_MARGIN = 0.03  # past the tyres on either side
# tarp
DROP_HEIGHT = 0.5  # drop sides
DROP_THICKNESS = 0.05
TARP_TOP = 2.75
TARP_SHOULDER = 0.06  # height of the tarp's rounded-off edge
TARP_INSET = 0.04  # tarp half width is the body's less this
TARP_CROWN = 0.06  # the roof is this much narrower than the walls
DROP_STRIPE = (0.15, 0.3)  # white stripe on the drop sides: height, top below the drop sides' top
STAKE = 0.1  # the middle stake splits the stripe
HEM = 0.05  # dark hem along the tarp's foot
HOOK = (0.03, 0.45, 0.08)  # hem hooks: width, pitch, reach down over the drop side
LACING = (0.04, 0.12)  # rope lacing at the tarp's front edges: dash height and pitch
POST_TARP = (0.1, 0.1)  # rear corner posts: depth, width
POST_BELOW_TOP = 0.3  # posts stop under the stalk lamps at the rear top corners
WARNING = 0.1  # red and white warning stripes on the posts, measured upright


def mirror(side, a, b):
    """Lateral range (a, b) measured outward from the centreline, on the side +1 (left) or -1."""
    return (a, b) if side > 0 else (-b, -a)


def floor(p, shape, hues):
    hw = p["width"] / 2
    shape.box((p["rearX"], p["bodyFront"]), (-hw, hw), (p["frameTop"], p["floorTop"]), hues["body"])


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


def mudguards(p, shape, colour, outer=None):
    """Mudguards over the rear tyres of each side, as wide as the tyres; `outer` widens them out to it."""
    radius = p["wheelRadius"]
    tyres = p["rearTyres"]
    reach = max(abs(o) for o in tyres["offsets"]) + tyres["width"] / 2 + GUARD_MARGIN
    centre = p["rearTrack"] / 2
    for side in (-1, 1):
        shape.arch(
            (p["rearAxleX"], radius),
            (radius + GUARD_CLEARANCE[0], radius + GUARD_CLEARANCE[1]),
            GUARD_ANGLES,
            mirror(side, centre - reach, max(centre + reach, outer or 0)),
            colour,
        )


def cylinder_x(shape, x, y, z, radius, colour, segments=12):
    shape.tube((x[0], y, z), (x[1], y, z), radius, colour, segments)


def chassis_kit(p, shape, hues):
    """Kit hung off the chassis rails between the axles, inside the body's width."""
    hw = p["width"] / 2
    silver, black = hues["silver"], hues["black"]
    rail = p["rail"]["halfGap"] + p["rail"]["width"] / 2
    if p["kind"] == "tipper":
        # an aluminium tool box on the left with a lid seam, a tank with black straps on the right
        box_x = (p["bodyFront"] - 0.85, p["bodyFront"] - 0.1)
        shape.box(box_x, (rail + 0.07, hw - 0.05), (0.5, 1.05), silver)
        for z in (0.68, 0.86):
            shape.box((box_x[0] + 0.04, box_x[1] - 0.04), (hw - 0.05, hw - 0.03), (z, z + 0.015), black)
        tank_x = (p["bodyFront"] - 1.35, p["bodyFront"] - 0.2)
        cylinder_x(shape, tank_x, -(rail + 0.32), 0.78, 0.27, silver)
        for x in (tank_x[0] + 0.15, tank_x[1] - 0.2):
            shape.box((x, x + 0.05), (-(rail + 0.6), -(rail + 0.04)), (0.5, 1.06), black)
        return
    # tarp: a silver tank and a black battery box on the left, a spare wheel on the right
    front = p["bodyFront"]
    cylinder_x(shape, (front - 0.85, front - 0.05), rail + 0.3, 0.75, 0.24, silver)
    shape.box((front - 1.35, front - 0.95), (rail + 0.05, hw - 0.15), (0.55, 1.0), black)
    radius = p["wheelRadius"] - 0.02
    x = front - 0.65
    y = (hw - 0.03, hw - 0.03 - p["rearTyres"]["width"])
    shape.tube((x, -y[1], radius + 0.12), (x, -y[0], radius + 0.12), radius, black, 12)
    shape.tube((x, -y[0] - 0.01, radius + 0.12), (x, -y[0], radius + 0.12), radius * 0.62, black, 12)
    shape.tube((x, -y[0] - 0.02, radius + 0.12), (x, -y[0] - 0.01, radius + 0.12), 0.08, silver)


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
        line, gap = STRIPE_LINE
        shape.box(side_x, mirror(side, hw, hw + p["relief"]), (stripe[0], stripe[0] + line), white)
        shape.box(side_x, mirror(side, hw, hw + p["relief"]), (stripe[0] + line + gap, stripe[1]), white)
        height, proud = PROFILE
        for z in PROFILES:
            if z0 + z + height > stripe[0] - 0.03:
                raise ValueError("a profile runs into the stripe")
            shape.box(side_x, mirror(side, hw, hw + proud), (z0 + z, z0 + z + height), body)
    headboard(p, shape, body)
    tailgate(p, shape, body, black, hues["red"])
    ladder(p, shape, hues["silver"])


def ladder(p, shape, silver):
    """A ladder hung on the left drop side by the rear post; below the floor it tucks in behind the side
    marking, which keeps its band."""
    hw, rear = p["width"] / 2, p["rearX"]
    spacing, section, proud, foot = LADDER
    mark = p["marking"]
    top = p["tipper"]["wallTop"] + RIM
    x0 = rear + POST[0] + 0.05
    rails = [(x0, x0 + section), (x0 + spacing - section, x0 + spacing)]
    outside = (hw + proud, hw + proud + section)
    tucked = (hw - section - 0.01, hw - 0.01)
    upper = (mark["zHigh"] + 0.02, top)
    lower = (foot, mark["zLow"] - 0.02)
    for x in rails:
        shape.box(x, outside, upper, silver)
        shape.box(x, tucked, lower, silver)
        shape.box(x, (hw, hw + proud), (top - 0.05, top), silver)
    z = foot + 0.1
    while z < top - 0.1:
        y = outside if z > upper[0] else tucked if z < lower[1] - 0.02 else None
        if y is not None:
            shape.box((x0 + section, x0 + spacing - section), y, (z, z + 0.03), silver)
        z += RUNG_PITCH


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


def tailgate(p, shape, body, black, red):
    """A separate gate between the rear corner posts, hung from a black hinge bar, with lock levers and
    a red contour along its foot and up its outer edges."""
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
        shape.box((face - 0.01, face), mirror(side, edge - 0.04 - CONTOUR, edge - 0.04), (z0 + 0.04 + CONTOUR, top - 0.04), red)
    shape.box((face - 0.01, face), (-edge + 0.04, edge - 0.04), (z0 + 0.04, z0 + 0.04 + CONTOUR), red)


def tarp(p, shape, hues):
    hw, relief = p["width"] / 2, p["relief"]
    rear, front = p["rearX"], p["bodyFront"]
    z0 = p["floorTop"]
    deck = z0 + DROP_HEIGHT
    body, white, black = hues["body"], hues["white"], hues["black"]
    depth, width = POST_TARP
    post_x = (rear + 0.01, rear + 0.01 + depth)
    post_top = TARP_TOP - POST_BELOW_TOP
    for side in (-1, 1):
        shape.box((post_x[1], front), mirror(side, hw - DROP_THICKNESS, hw), (z0, deck), body)
        shape.box(post_x, mirror(side, hw - width, hw), (z0, post_top), body)
        warning_stripes(shape, rear, side, (hw - width, hw), (z0, post_top), hues)
    shape.box((front - 0.1, front), (-hw, hw), (z0, deck), body)
    shape.box((post_x[0], post_x[0] + 0.05), (-hw + width, hw - width), (z0, deck), body)
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
    shape.prism(section, rear + 0.02, front, body, frame="yz")
    stripe_top = deck - DROP_STRIPE[1]
    stripe_z = (stripe_top - DROP_STRIPE[0], stripe_top)
    mid = (post_x[1] + front) / 2
    hook_w, pitch, reach = HOOK
    dash, step = LACING
    for side in (-1, 1):
        outer = mirror(side, hw, hw + relief)
        shape.box((post_x[1] + 0.05, mid - STAKE / 2), outer, stripe_z, white)
        shape.box((mid + STAKE / 2, front - 0.05), outer, stripe_z, white)
        shape.box((mid - STAKE / 2, mid + STAKE / 2), outer, (z0, deck), body)
        shape.box((post_x[1], front), mirror(side, wt, wt + relief), (deck, deck + HEM), black)
        count = int((front - post_x[1] - 0.2) / pitch)
        for i in range(count + 1):
            x = post_x[1] + 0.1 + (front - post_x[1] - 0.2) * i / count
            if abs(x - mid) < STAKE:
                continue
            shape.box((x - hook_w / 2, x + hook_w / 2), mirror(side, hw, hw + relief / 2), (deck - reach, deck), black)
        z = deck + HEM + step / 2
        while z + dash < z1 - 0.02:
            shape.box((front - 0.06, front - 0.02), mirror(side, wt, wt + relief), (z, z + dash), black)
            z += step


def warning_stripes(shape, rear, side, y, z, hues):
    """Red and white stripes on a rear corner post's rear face, sloping down to the outside."""
    (y0, y1), (z0, z1) = (y if side > 0 else (-y[1], -y[0])), z
    rect = [(y0, z0), (y1, z0), (y1, z1), (y0, z1)]
    # bands of z + side * y, so the stripes fall towards the body's side
    lo = z0 + min(side * y0, side * y1)
    hi = z1 + max(side * y0, side * y1)
    k = 0
    c = lo
    while c < hi:
        poly = clip(clip(rect, lambda u, v: v + side * u - c), lambda u, v: c + WARNING - (v + side * u))
        if len(poly) >= 3:
            shape.prism(poly, rear, rear + 0.01, hues["red"] if k % 2 == 0 else hues["white"], frame="yz")
        c += WARNING
        k += 1


def clip(poly, f):
    """The part of a convex polygon where f(u, v) >= 0."""
    out = []
    for i, a in enumerate(poly):
        b = poly[(i + 1) % len(poly)]
        fa, fb = f(*a), f(*b)
        if fa >= 0:
            out.append(a)
        if (fa >= 0) != (fb >= 0):
            t = fa / (fa - fb)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    unique = []
    for q in out:
        if not unique or abs(q[0] - unique[-1][0]) + abs(q[1] - unique[-1][1]) > 1e-6:
            unique.append(q)
    if len(unique) > 1 and abs(unique[0][0] - unique[-1][0]) + abs(unique[0][1] - unique[-1][1]) <= 1e-6:
        unique.pop()
    return unique


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
    side marking and the detail's lamps each keep a face to sit on."""
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
    LAMP["check_seated"](shape, p["mounts"])


def main():
    params = COMMON["load_params"](globals())
    if params["kind"] not in ("tipper", "tarp"):
        raise ValueError("unknown body kind " + repr(params["kind"]))
    hashes = COMMON["provenance"](
        __file__, {"commonSha256": COMMON_FILE, "lampCommonSha256": LAMP_FILE}, params
    )
    COMMON["check_expected"](hashes, globals().get("EXPECTED_SHA256"))
    hues = {key: srgb(value) for key, value in sorted(params["hues"].items())}

    shape = Shape()
    if params["kind"] == "tipper":
        subframe(params, shape, hues)
        mudguards(params, shape, hues["black"])
        tipper(params, shape, hues)
    else:
        floor(params, shape, hues)
        mudguards(params, shape, hues["white"], params["width"] / 2)
        tarp(params, shape, hues)
    chassis_kit(params, shape, hues)
    check_bands(params, shape)
    return COMMON["export"](OUT_PATH, "body-shell", hashes, [("body", shape)])


RESULT = main()
