"""THW trailer shell for the Gegenlenker mirrors (issue #133).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/<id>.trailer.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH (for hosts that cannot read the path)
  OUT_PATH     where the raw .glb is written
  EXPECTED_SHA256  optional {"scriptSha256": ..., "commonSha256": ...}; the run aborts on a mismatch

Vertex-coloured meshes, one node each (shell_common.py):
  "trailer"       in the trailer body frame, origin at the effective rear axle, +X forward
  "dolly"         in the dolly frame, origin at the turntable centre, +X forward (towards the drawbar eye)
  "trailer-lens"  the shell's own lamp lenses (`lenses`, src/render/lamp-layout.ts), when it has any
Livery is colours only: no lettering, emblems or maker logos. Kinds: "low-loader" (a machine
transporter for a wheel loader: a THW-blue deck with four wheel troughs, a raised front section and a
grated rear section sloping down to tall aluminium ladder ramps folded upright behind it, on dark-blue
side members, crossmembers and beams, with lashing points and a rear lamp carrier) and "lafette"
(a bare swap-body chassis: black frame, white side guard carrying the side contour and marker lamps,
silver toolbox, yellow locating stops).

The shell stays inside the procedural trailer's footprint and clear of what the procedural detail
owns: the lamps (`mounts`, which need a face of the shell: the ramps, a lamp carrier), the underrun guard,
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
MARKING_STEP = 0.05  # spacing of the side marking's coverage check
PLATE = 0.08  # deck plating
SIDE_MEMBER = (0.12, 0.06)  # width, and rise above the deck top
SKIRT = (0.12, 0.1)  # side members hang this much deeper, from this far ahead of the tandem tyres
STEP = 0.3  # length of the rise up to the front section
GRATE_DROP = 0.03  # the grating's pan lies this far below the bar tops
GRATE_BAR = 0.04
GRATE_PITCH = 0.12
PAN = 0.01
TROUGH = (0.9, 0.55, 0.06)  # wheel trough length, width and depth
TROUGH_AXLES = 2.2  # loader wheelbase: troughs straddle the main deck's middle
TROUGH_TRACK = 1.6
CROSS = (0.1, 0.1, 0.8)  # crossmember width, depth below the underside, pitch
CROSS_REACH = 0.75  # crossmembers stay inboard of the tyres
BEAM = ((0.38, 0.52), 0.15)  # main beams: lateral range, depth below the underside
LASHING = (0.08, 0.03, 1.0)  # lashing point length and height, pitch
LASHING_MARGIN = 0.4  # lashing points keep this much of the main deck's length clear, split between both ends
STRINGER = 0.08  # ramp side rails
RUNG = (0.04, 0.18)  # ramp rung height and pitch
RAMP_CAP = 0.06
HINGE = (0.12, 0.04, 0.08)  # hinge block width, reach below and above the rear deck
# lafette; the lamp bar and side guard come from params["lafette"]
CROSS_WIDTH = 0.12
CROSS_DEPTH = 0.14
CROSS_PITCH = 1.0
STOP = (0.12, 0.3)  # footprint and height of a locating stop
STOP_OFFSETS = (0.15, 0.45)
STAY = (0.06, 0.2)  # width and reach inboard
TOOLBOX = ((1.3, 2.5), (0.6, 1.15), 0.4)  # x, y, height below the frame
# dolly
SEGMENTS = 16
TUBE_SEGMENTS = 8


def swing_radius(p):
    """Plan radius about the turntable of the dolly's tyre corners, which sweep as the body turns."""
    d = p["dolly"]
    return math.hypot(abs(d["axleX"]) + p["wheelRadius"], p["track"] / 2 + p["wheelWidth"] / 2)


def mirror(side, a, b):
    """Lateral range (a, b) measured outward from the centreline, on the side +1 (left) or -1."""
    return (a, b) if side > 0 else (-b, -a)


def sloped(shape, xs, bottoms, tops, y, colour):
    """A beam between upright ends at xs[0] and xs[1], its bottom and top edges straight between them."""
    (xa, xb), (ba, bb), (ta, tb) = xs, bottoms, tops
    # the "zx" frame takes (z, x) pairs and extrudes along y
    shape.prism([(ba, xa), (bb, xb), (tb, xb), (ta, xa)], y[0], y[1], colour, frame="zx")


def troughs(p, start, end):
    """Plan rectangles of the four wheel troughs, centred on the main deck."""
    length, width, _ = TROUGH
    mid = (start + end) / 2
    out = []
    for xc in (mid - TROUGH_AXLES / 2, mid + TROUGH_AXLES / 2):
        for yc in (-TROUGH_TRACK / 2, TROUGH_TRACK / 2):
            out.append(((xc - length / 2, xc + length / 2), (yc - width / 2, yc + width / 2)))
    return out


def plating(shape, xs, ys, holes, z, colour):
    """Deck plating over xs by ys with rectangular holes, laid as the grid cells outside them."""
    for hx, hy in holes:
        if hx[0] < xs[0] - EPS or hx[1] > xs[1] + EPS or hy[0] < ys[0] - EPS or hy[1] > ys[1] + EPS:
            raise ValueError("a wheel trough leaves the deck plating")
    cuts_x = sorted({xs[0], xs[1], *(c for (x, _) in holes for c in x)})
    cuts_y = sorted({ys[0], ys[1], *(c for (_, y) in holes for c in y)})
    for x0, x1 in zip(cuts_x, cuts_x[1:]):
        for y0, y1 in zip(cuts_y, cuts_y[1:]):
            inside = any(hx[0] <= x0 + EPS and x1 <= hx[1] + EPS and hy[0] <= y0 + EPS and y1 <= hy[1] + EPS for hx, hy in holes)
            if not inside:
                shape.box((x0, x1), (y0, y1), z, colour)


def deck_low_loader(p, shape, hues):
    hw, rear, front = p["width"] / 2, p["rearX"], p["frontX"]
    under, deck = p["underside"], p["deck"]
    d = p["lowLoader"]
    base, frame, silver, black = hues["base"], hues["frame"], hues["silver"], hues["black"]
    drop = deck - d["rearDeck"]
    width, rise = SIDE_MEMBER
    inner = hw - width
    step = d["frontStart"] - STEP
    # beams below the underside end clear of the dolly tyres' swing
    reach = p["dolly"]["turntableX"] - swing_radius(p) - p["swingMargin"] - 0.05
    skirt = (max(p["rearAxleXs"]) + p["wheelRadius"] + SKIRT[1], reach)
    order = (rear, d["carrierX"], d["slopeEnd"], d["slopeEnd"] + GRATE_BAR, d["slopeStart"], skirt[0], skirt[1], step, d["frontStart"], front)
    if any(a >= b for a, b in zip(order, order[1:])) or d["slopeStart"] + CROSS[0] >= reach or step - d["slopeStart"] < LASHING_MARGIN:
        raise ValueError("the low-loader's deck breaks are out of order or leave too little room")

    # side members, following the deck: sloped rear, main deck, step and raised front; between the
    # tandem's mudflaps and the dolly's swing they hang deeper
    for side in (-1, 1):
        y = mirror(side, inner, hw)
        shape.box((d["carrierX"], d["slopeEnd"]), y, (under - drop, d["rearDeck"] + rise), frame)
        sloped(shape, (d["slopeEnd"], d["slopeStart"]), (under - drop, under), (d["rearDeck"] + rise, deck + rise), y, frame)
        shape.box((d["slopeStart"], skirt[0]), y, (under, deck + rise), frame)
        shape.box(skirt, y, (under - SKIRT[0], deck + rise), frame)
        shape.box((skirt[1], step), y, (under, deck + rise), frame)
        sloped(shape, (step, d["frontStart"]), (under, under), (deck + rise, d["frontDeck"] + rise), y, frame)
        shape.box((d["frontStart"], front), y, (under, d["frontDeck"] + rise), frame)
    shape.box((front - 0.1, front), (-inner, inner), (under, d["frontDeck"]), frame)

    # lamp carrier across the rear, the ramps' hinges just ahead of it
    shape.box((rear, d["carrierX"]), (-hw, hw), (under, d["carrierTop"]), frame)

    # main deck: plating with four wheel troughs, then the step and the raised front section
    holes = troughs(p, d["slopeStart"], step)
    plating(shape, (d["slopeStart"], step), (-inner, inner), holes, (deck - PLATE, deck), base)
    trough_floor = deck - TROUGH[2]
    for x, y in holes:
        shape.box(x, y, (trough_floor - PAN, trough_floor), black)
    sloped(shape, (step, d["frontStart"]), (deck - PLATE, d["frontDeck"] - PLATE), (deck, d["frontDeck"]), (-inner, inner), base)
    shape.box((d["frontStart"], front - 0.1), (-inner, inner), (d["frontDeck"] - PLATE, d["frontDeck"]), base)

    # rear section: a grating over a black pan, sloping down to the ramps
    run = d["slopeStart"] - d["slopeEnd"]

    def top_at(x):
        return d["rearDeck"] + drop * (x - d["slopeEnd"]) / run

    sloped(
        shape,
        (d["slopeEnd"], d["slopeStart"]),
        (d["rearDeck"] - GRATE_DROP - PAN, deck - GRATE_DROP - PAN),
        (d["rearDeck"] - GRATE_DROP, deck - GRATE_DROP),
        (-inner, inner),
        black,
    )
    bars = int((run - GRATE_BAR) / GRATE_PITCH + EPS) + 1
    for i in range(bars):
        x = d["slopeEnd"] + i * GRATE_PITCH
        z = top_at(x + GRATE_BAR / 2)
        shape.box((x, x + GRATE_BAR), (-inner, inner), (z - GRATE_DROP, z), base)

    # structure below the deck: crossmembers, two main beams and the axles
    cross_w, cross_d, pitch = CROSS
    span = reach - d["slopeStart"] - cross_w
    count = max(2, round(span / pitch) + 1)
    for i in range(count):
        x = d["slopeStart"] + span * i / (count - 1)
        shape.box((x, x + cross_w), (-CROSS_REACH, CROSS_REACH), (under - cross_d, deck - PLATE), frame)
    (beam_in, beam_out), beam_d = BEAM
    for side in (-1, 1):
        shape.box((d["slopeStart"], reach), mirror(side, beam_in, beam_out), (under - beam_d, deck - PLATE), frame)
    for x in p["rearAxleXs"]:
        shape.box((x - p["axleHalf"], x + p["axleHalf"]), (-p["track"] / 2, p["track"] / 2), p["axleZ"], black)

    # lashing points along the side members' tops
    length, height, spacing = LASHING
    count = int((step - d["slopeStart"] - LASHING_MARGIN) / spacing + EPS) + 1
    for i in range(count):
        x = d["slopeStart"] + LASHING_MARGIN / 2 + i * spacing
        for side in (-1, 1):
            shape.box((x, x + length), mirror(side, inner + 0.02, hw - 0.02), (deck + rise, deck + rise + height), black)

    ramps(p, shape, silver, black)


def ramps(p, shape, silver, black):
    """Aluminium ladder ramps folded upright between the lamp carrier and the sloped deck."""
    d, ramp = p["lowLoader"], p["ramp"]
    xs = (d["carrierX"], d["slopeEnd"])
    z0, top = d["rearDeck"], d["rampTop"]
    rung_h, pitch = RUNG
    hinge_w, below, above = HINGE
    for side in (-1, 1):
        outer = mirror(side, ramp["gap"], ramp["gap"] + ramp["width"])
        for y in (mirror(side, ramp["gap"], ramp["gap"] + STRINGER), mirror(side, ramp["gap"] + ramp["width"] - STRINGER, ramp["gap"] + ramp["width"])):
            shape.box(xs, y, (z0, top), silver)
        rungs = mirror(side, ramp["gap"] + STRINGER, ramp["gap"] + ramp["width"] - STRINGER)
        count = int((top - RAMP_CAP - z0 - 0.15) / pitch + EPS)
        if count < 1:
            raise ValueError("the folded ramps are too short for a rung")
        for k in range(count):
            z = z0 + 0.15 + k * pitch
            shape.box((xs[0] + 0.02, xs[1] - 0.02), rungs, (z, z + rung_h), silver)
        shape.box(xs, outer, (top - RAMP_CAP, top), silver)
        for inset in (0.02, ramp["width"] - hinge_w - 0.02):
            shape.box(xs, mirror(side, ramp["gap"] + inset, ramp["gap"] + inset + hinge_w), (z0 - below, z0 + above), black)


def side_marking(p, shape, side, outer, span, hues):
    """ECE R48 side contour on the guard's top bar, which stands in for the swap body's; its marker lamps are lenses."""
    mark, guard = p["marking"], p["lafette"]
    x0, x1 = span[0] + mark["endMargin"], span[1] - mark["endMargin"]
    z_mid = sum(guard["guardBars"][-1]) / 2
    strip = (z_mid - mark["strip"] / 2, z_mid + mark["strip"] / 2)
    relief = guard["markRelief"][0]
    across = (outer, outer + relief) if side > 0 else (-outer - relief, -outer)
    shape.box((x0, x1), across, strip, hues["contour"])


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
    guard = p["lafette"]
    bar = guard["lampBar"]
    shape.box((rear, rear + bar["depth"]), (-hw, hw), (deck, deck + bar["height"]), base)
    size, height = STOP
    for side in (-1, 1):
        y = (hw - 0.2 - size / 2, hw - 0.2 + size / 2)
        if side < 0:
            y = (-y[1], -y[0])
        for offset in STOP_OFFSETS:
            for x in (rear + offset, front - offset - size):
                shape.box((x, x + size), y, (deck, deck + height), yellow)
    start, end = guard["guardSpan"]
    bars = guard["guardBars"]
    stay_w, stay_reach = STAY
    for side in (-1, 1):
        inner, outer = hw - guard["guardY"][0], hw - guard["guardY"][1]
        y = (inner, outer) if side > 0 else (-outer, -inner)
        for z in bars:
            shape.box((start, end), y, z, white)
        reach_y = (outer - stay_reach, outer + 0.01)
        stay_y = reach_y if side > 0 else (-reach_y[1], -reach_y[0])
        for x in (start + 0.03, (start + end) / 2, end - stay_w - 0.03):
            shape.box((x, x + stay_w), stay_y, (bars[0][0] + 0.02, deck - CROSS_DEPTH), base)
        side_marking(p, shape, side, outer, (start, end), hues)
    for x, y, z in p["brackets"]:
        shape.box(x, y, z, base)
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


def inside(poly, x, z, tol=1e-5):
    """Whether (x, z) lies in the convex polygon, within tol."""
    signs = set()
    for (x0, z0), (x1, z1) in zip(poly, poly[1:] + poly[:1]):
        length = math.hypot(x1 - x0, z1 - z0)
        if length < EPS:
            continue
        cross = ((x1 - x0) * (z - z0) - (z1 - z0) * (x - x0)) / length
        if abs(cross) > tol:
            signs.add(cross > 0)
    return len(signs) < 2


def check_marking(p, shape):
    """The side marking, which follows the deck down its slope, keeps a face on each side to sit on."""
    d, mark, hw = p["lowLoader"], p["marking"], p["width"] / 2
    centre = (p["deck"] + p["underside"]) / 2
    half = max(mark["strip"], min(mark["markerHeight"], p["deck"] - p["underside"])) / 2
    start, end = p["rearX"] + mark["endMargin"], p["frontX"] - mark["endMargin"]
    steps = math.ceil((end - start) / MARKING_STEP)
    for side in (-1, 1):
        faces = []
        for face in shape.faces:
            points = [shape.verts[i] for i in face]
            if all(abs(y - side * hw) < EPS for _, y, _ in points):
                faces.append([(x, z) for x, _, z in points])
        for i in range(steps + 1):
            x = start + (end - start) * i / steps
            slope = min(1.0, max(0.0, (x - d["slopeEnd"]) / (d["slopeStart"] - d["slopeEnd"])))
            z = centre + (d["rearDeck"] - p["deck"]) * (1 - slope)
            for edge in (z - half, z + half):
                if not any(inside(poly, x, edge) for poly in faces):
                    raise ValueError("the side marking has no face to sit on")


def check_trailer(p, shape):
    hw = p["width"] / 2
    guard = p["guard"]
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
    if p["kind"] == "low-loader":
        check_marking(p, shape)
    else:
        start, end = p["lafette"]["guardSpan"]
        if not max(p["rearAxleXs"]) + p["wheelRadius"] < start < end:
            raise ValueError("the side guard reaches the rear tyres")
    COMMON["check_seated"](shape, p["mounts"] + p["lenses"])


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
    objects = [("trailer", body), ("dolly", tow)]
    if params["lenses"]:
        objects.append(("trailer-lens", COMMON["lens_shape"](params["lenses"])))
    return COMMON["export"](OUT_PATH, "trailer-shell", hashes, objects)


RESULT = main()
