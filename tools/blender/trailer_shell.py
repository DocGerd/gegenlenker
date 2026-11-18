"""THW trailer shell for the Gegenlenker mirrors (issue #133).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/<id>.trailer.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH (for hosts that cannot read the path)
  OUT_PATH     where the raw .glb is written
  EXPECTED_SHA256  optional {"scriptSha256": ..., "commonSha256": ...}; the run aborts on a mismatch

Two vertex-coloured meshes, as two nodes (shell_common.py):
  "trailer"  in the trailer body frame, origin at the effective rear axle, +X forward
  "dolly"    in the dolly frame, origin at the turntable centre, +X forward (towards the drawbar eye)
Livery is colours only: no lettering, emblems or maker logos. Kinds: "low-loader" (THW-blue deck and
frame, a grating on the rear deck, silver loading ramps folded upright at the back) and "lafette"
(a bare swap-body chassis: black frame, white side guard carrying the side contour and marker lamps,
silver toolbox, yellow locating stops).

The shell stays inside the procedural trailer's footprint and clear of what the procedural detail
owns: the tail lamps on the rear face (they sit on the ramps or a lamp carrier), the underrun guard,
and the side marking on the deck slab's sides (the shell never passes the half width). Nothing
below the underside enters the swing of the dolly's tyres about the turntable.

Tested Blender version: 5.3.0 (bpy.app.version_string is printed and recorded in the manifest).
"""

import math
import os
import runpy

COMMON_FILE = os.path.join(os.path.dirname(__file__), "shell_common.py")
COMMON = runpy.run_path(COMMON_FILE)
Shape = COMMON["Shape"]
srgb = COMMON["srgb_to_linear"]

EPS = 1e-6
# low-loader
GRATE_LENGTH = 1.0  # rear deck section laid as a grating
GRATE_DROP = 0.03  # the grating's pan lies this far below the deck top
GRATE_BAR = 0.04
GRATE_PITCH = 0.12
PAN_RISE = 0.005
SIDE_BEAM = 0.14  # edge beams along the deck
SIDE_BEAM_RISE = 0.05
RAMP_RIBS = 5
RAMP_RIB = (0.04, 0.02)  # height and depth of the anti-slip ribs
HINGE = 0.12
# lafette
CROSS_WIDTH = 0.12
CROSS_DEPTH = 0.14
CROSS_PITCH = 1.0
LAMP_BAR = (0.06, 0.4)  # depth and height of the lamp carrier above the deck
STOP = (0.12, 0.3)  # footprint and height of a locating stop
STOP_OFFSETS = (0.15, 0.45)
GUARD_BARS = ((0.58, 0.68), (0.78, 0.88))
GUARD_Y = (0.08, 0.03)  # inner and outer inset of the side guard from the half width
GUARD_START_GAP = 0.15  # in front of the rear wheel
GUARD_END_GAP = 0.4  # behind the deck front
MARK_RELIEF = (0.01, 0.02)  # contour strip and marker lamps stand this far off the guard's outer face
STAY = (0.06, 0.2)  # width and reach inboard
TOOLBOX = ((1.3, 2.5), (0.6, 1.15), 0.4)  # x, y, height below the frame
# dolly
SEGMENTS = 16
TUBE_SEGMENTS = 8


def rear_axle_front(p):
    return max(p["rearAxleXs"]) + p["wheelRadius"]


def swing_radius(p):
    """Plan radius about the turntable of the dolly's tyre corners, which sweep as the body turns."""
    d = p["dolly"]
    return math.hypot(abs(d["axleX"]) + p["wheelRadius"], p["track"] / 2 + p["wheelWidth"] / 2)


def deck_low_loader(p, shape, hues):
    hw, rear, front = p["width"] / 2, p["rearX"], p["frontX"]
    z0, deck = p["underside"], p["deck"]
    base, silver, black = hues["base"], hues["silver"], hues["black"]
    pan_z = deck - GRATE_DROP
    inner = hw - SIDE_BEAM
    shape.box((rear, front), (-hw, hw), (z0, pan_z), base)
    shape.box((rear + GRATE_LENGTH, front), (-inner, inner), (pan_z, deck), base)
    for side in (-1, 1):
        lateral = (inner, hw) if side > 0 else (-hw, -inner)
        shape.box((rear, front), lateral, (pan_z, deck + SIDE_BEAM_RISE), base)
    shape.box(
        (rear + 0.01, rear + GRATE_LENGTH), (-inner, inner), (pan_z, pan_z + PAN_RISE), black
    )
    bars = int(GRATE_LENGTH / GRATE_PITCH + EPS) + 1
    for i in range(bars):
        x = rear + i * GRATE_PITCH
        shape.box((x, x + GRATE_BAR), (-inner, inner), (pan_z, deck), base)
    ramp = p["ramp"]
    top = deck + ramp["height"]
    rib_h, rib_d = RAMP_RIB
    for side in (-1, 1):
        y = (ramp["gap"], ramp["gap"] + ramp["width"])
        if side < 0:
            y = (-y[1], -y[0])
        front_face = rear + ramp["thickness"]
        shape.box((rear, front_face), y, (deck, top), silver)
        for k in range(RAMP_RIBS):
            z = deck + 0.25 + k * (ramp["height"] - 0.5) / (RAMP_RIBS - 1)
            shape.box((front_face, front_face + rib_d), (y[0] + 0.05, y[1] - 0.05), (z, z + rib_h), silver)
        for inset in (0.02, ramp["width"] - HINGE - 0.02):
            y0 = y[0] + inset
            shape.box((rear + 0.02, front_face + 0.04), (y0, y0 + HINGE), (deck, deck + HINGE), black)
    for x in p["rearAxleXs"]:
        shape.box((x - p["axleHalf"], x + p["axleHalf"]), (-p["track"] / 2, p["track"] / 2), p["axleZ"], black)


def side_marking(p, shape, side, outer, span, hues):
    """ECE R48 side contour and marker lamps on the guard's top bar, which stands in for the swap body's."""
    mark = p["marking"]
    x0, x1 = span[0] + mark["endMargin"], span[1] - mark["endMargin"]
    z_mid = sum(GUARD_BARS[-1]) / 2
    strip = (z_mid - mark["strip"] / 2, z_mid + mark["strip"] / 2)
    lamp = (z_mid - mark["markerHeight"] / 2, z_mid + mark["markerHeight"] / 2)
    relief_strip, relief_lamp = MARK_RELIEF

    def across(relief):
        return (outer, outer + relief) if side > 0 else (-outer - relief, -outer)

    shape.box((x0, x1), across(relief_strip), strip, hues["contour"])
    count = max(2, math.ceil((x1 - x0) / mark["spacing"]) + 1)
    length = mark["markerLength"]
    for i in range(count):
        x = x0 + length + (x1 - x0 - 2 * length) * i / (count - 1)
        shape.box((x - length / 2, x + length / 2), across(relief_lamp), lamp, hues["marker"])


def deck_lafette(p, shape, hues):
    hw, rear, front = p["width"] / 2, p["rearX"], p["frontX"]
    z0, deck = p["underside"], p["deck"]
    base, white, silver, yellow = hues["base"], hues["white"], hues["silver"], hues["yellow"]
    rail = p["rail"]
    for side in (-1, 1):
        y = (rail["halfGap"] - rail["width"] / 2, rail["halfGap"] + rail["width"] / 2)
        if side < 0:
            y = (-y[1], -y[0])
        shape.box((rear, front), y, (z0, deck), base)
    reach = hw - 0.1
    span = front - rear - CROSS_WIDTH
    count = int(span / CROSS_PITCH + EPS) + 1
    for i in range(count + 1):
        x = rear + span * i / count
        shape.box((x, x + CROSS_WIDTH), (-reach, reach), (deck - CROSS_DEPTH, deck), base)
    bar_depth, bar_height = LAMP_BAR
    shape.box((rear, rear + bar_depth), (-hw, hw), (deck, deck + bar_height), base)
    size, height = STOP
    for side in (-1, 1):
        y = (hw - 0.2 - size / 2, hw - 0.2 + size / 2)
        if side < 0:
            y = (-y[1], -y[0])
        for offset in STOP_OFFSETS:
            for x in (rear + offset, front - offset - size):
                shape.box((x, x + size), y, (deck, deck + height), yellow)
    start = rear_axle_front(p) + GUARD_START_GAP
    end = min(front - GUARD_END_GAP, p["dolly"]["turntableX"] - swing_radius(p) - p["swingMargin"])
    stay_w, stay_reach = STAY
    for side in (-1, 1):
        inner, outer = hw - GUARD_Y[0], hw - GUARD_Y[1]
        y = (inner, outer) if side > 0 else (-outer, -inner)
        for z in GUARD_BARS:
            shape.box((start, end), y, z, white)
        reach_y = (outer - stay_reach, outer + 0.01)
        stay_y = reach_y if side > 0 else (-reach_y[1], -reach_y[0])
        for x in (start + 0.03, (start + end) / 2, end - stay_w - 0.03):
            shape.box((x, x + stay_w), stay_y, (GUARD_BARS[0][0] + 0.02, deck - CROSS_DEPTH), base)
        side_marking(p, shape, side, outer, (start, end), hues)
    (x0, x1), (y0, y1), drop = TOOLBOX
    shape.box((x0, x1), (y0, y1), (z0 - drop, z0), silver)
    shape.box((1.85, 1.95), (y1, y1 + 0.02), (z0 - drop + 0.1, z0 - drop + 0.2), base)
    for x in p["rearAxleXs"]:
        shape.box((x - p["axleHalf"], x + p["axleHalf"]), (-p["track"] / 2, p["track"] / 2), p["axleZ"], base)


def dolly(p, shape, hues):
    d = p["dolly"]
    base = hues["base"]
    dark = hues.get("black", base)
    radius = d["armRadius"]
    for side in (-1, 1):
        start = (0.0, side * d["spread"], d["plateMid"])
        bend = (d["kink"], side * d["spread"] * (1 - d["kink"] / d["eyeX"]), d["plateMid"])
        end = (d["eyeX"], 0.0, d["eyeZ"])
        shape.tube(start, bend, radius, base, TUBE_SEGMENTS)
        shape.tube(bend, end, radius, base, TUBE_SEGMENTS)
    eye_x, eye_z, eye = d["eyeX"], d["eyeZ"], d["eyeBlock"]
    shape.box(
        (eye_x - eye["back"], eye_x + eye["front"]),
        (-eye["halfWidth"], eye["halfWidth"]),
        (eye_z - eye["halfHeight"], eye_z + eye["halfHeight"]),
        dark,
    )
    ring = [
        (d["plateRadius"] * math.cos(2 * math.pi * i / SEGMENTS), d["plateRadius"] * math.sin(2 * math.pi * i / SEGMENTS))
        for i in range(SEGMENTS)
    ]
    shape.prism(ring, d["plateBottom"], d["plateTop"], base)
    ax, half = d["axleX"], d["postHalf"]
    shape.box((ax - half, ax + half), (-half, half), (p["axleZ"][1], d["plateBottom"]), base)
    shape.box((ax - p["axleHalf"], ax + p["axleHalf"]), (-p["track"] / 2, p["track"] / 2), p["axleZ"], dark)


def swing_gap(p, xs, ys):
    """Plan distance from the turntable to a face's footprint, less the dolly tyres' swing radius."""
    tx = p["dolly"]["turntableX"]
    dx = max(xs[0] - tx, 0.0, tx - xs[1])
    dy = max(ys[0], 0.0, -ys[1])
    return math.hypot(dx, dy) - swing_radius(p)


def check_trailer(p, shape):
    hw = p["width"] / 2
    lamp, guard = p["tailLamp"], p["guard"]
    inner, outer = hw - lamp["inset"] - lamp["width"], hw - lamp["inset"]
    half_guard = hw - guard["inset"]
    for (x0, x1), (y0, y1), (z0, z1) in shape.extents():
        if x0 < p["rearX"] - EPS:
            raise ValueError("a face lies behind the rear face, where the tail lamps are")
        if x1 > p["frontX"] + EPS:
            raise ValueError("a face reaches past the deck front")
        if max(abs(y0), abs(y1)) > hw + EPS:
            raise ValueError("a face passes the half width, where the side marking is")
        if x0 < p["rearX"] + guard["depth"] - EPS and y0 < half_guard - EPS and y1 > -half_guard + EPS:
            if z0 < p["underside"] - EPS:
                raise ValueError("a face lies in the underrun guard")
        if z0 < p["underside"] - EPS and swing_gap(p, (x0, x1), (y0, y1)) < p["swingMargin"] - EPS:
            raise ValueError("a face below the underside enters the dolly wheels' swing")
    # the tail lamps stand on the ramps or the lamp carrier
    z_low, z_high = p["deck"] + lamp["sill"], p["deck"] + lamp["sill"] + lamp["height"]
    carriers = []
    for (x0, x1), (y0, y1), (z0, z1) in shape.extents():
        if abs(x0 - p["rearX"]) < EPS and abs(x1 - p["rearX"]) < EPS and z0 <= z_low + EPS and z1 >= z_high - EPS:
            carriers.append((y0, y1))
    for side in (-1, 1):
        want = (inner, outer) if side > 0 else (-outer, -inner)
        if not any(y0 <= want[0] + EPS and y1 >= want[1] - EPS for y0, y1 in carriers):
            raise ValueError("a tail lamp has no surface to sit on")


def check_dolly(p, shape):
    d = p["dolly"]
    for (x0, x1), _, (z0, z1) in shape.extents():
        if x1 <= d["kink"] + 1e-5 and z1 > d["plateTop"] + 1e-5:
            raise ValueError("a drawbar part rises into the trailer's swing")


def main():
    params = COMMON["load_params"](globals())
    if params["kind"] not in ("low-loader", "lafette"):
        raise ValueError("unknown trailer kind " + repr(params["kind"]))
    hashes = COMMON["provenance"](__file__, COMMON_FILE, params)
    COMMON["check_expected"](hashes, globals().get("EXPECTED_SHA256"))
    hues = {key: srgb(value) for key, value in sorted(params["hues"].items())}

    body = Shape()
    if params["kind"] == "low-loader":
        deck_low_loader(params, body, hues)
    else:
        deck_lafette(params, body, hues)
    check_trailer(params, body)
    tow = Shape()
    dolly(params, tow, hues)
    check_dolly(params, tow)
    return COMMON["export"](OUT_PATH, "trailer-shell", hashes, [("trailer", body), ("dolly", tow)])


RESULT = main()
