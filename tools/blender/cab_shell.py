"""THW truck cab shell for the Gegenlenker mirrors (issues #68, #133).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/<id>.cab.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH (for hosts that cannot read the path)
  OUT_PATH     where the raw .glb is written
  EXPECTED_SHA256  optional {"scriptSha256": ..., "commonSha256": ..., "lampCommonSha256": ...}; the run aborts on a mismatch

Three vertex-coloured meshes in the sim body frame (blender_common.py): "cab", "cab-glass" with the
windows (a node of their own so the renderer can keep them out of the sun shadow, #159), and "cab-lens"
with the lamp lenses of `lenses` (src/render/lamp-layout.ts). Livery is colours only: no lettering, emblems or
maker logos. Styles: "day" (short day cab, after the Arocs: two-tone grille, skid plate under the
bumper, light bar with end guards) and "crew" (double cab after the MAN L2000: a second side window
row, wide arch flares, a roof rack, a light bar in a tubular frame and a front tow coupling).

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
CORNER = 0.12  # vertical front edges are chamfered by this much (<= every glass/lamp inset)
ROOF = 0.12  # the roof's front edge drops and recedes by this much
BUMPER_DEPTH = 0.15
CORNER_LENGTH = 0.5  # white lower front corner wraps this far back along each side
CORNER_HEIGHT = 0.5
STRIPE = (0.62, 0.76)  # side stripe, above the frame top: a thin line, a gap, then the broad band
STRIPE_LINE = (0.03, 0.02)  # thin line and gap at the stripe's foot
CREW_GLASS = (0.2, 0.75)  # pillar gap and length of the second side window
ARCH = {  # angles, and inner and outer radius beyond the tyre; the crew cab's flares are wider
    "day": ((35, 145), (0.06, 0.16)),
    "crew": ((25, 155), (0.04, 0.24)),
}
STEP_WELL = (0.3, 0.42, 0.04)  # depth, foot above the ground, inset from the cab side (the class V field starts there)
STEP_TREADS = ((0.45, 0.51), (0.78, 0.84))
STEP_CLEARANCE = 0.08  # between the arch flare and the step well
BEACON_BASE = 0.04
BEACON_HEIGHT = 0.1
BAR = (0.95, 0.25, 0.3)  # light bar half width, depth, and length of the blue end domes
BAR_SETBACK = 0.2  # behind the roof's front edge, so the guards stay out of the chase view's front face
GUARD_TUBE = (0.015, 0.11)  # light bar guard: tube radius and height of its rail above the roof
SKID = (0.12, 0.35, 0.8)  # skid plate under the bumper: height, depth, half width
GRILLE_BLACK = 0.6  # share of the day cab's grille that is black; a blue panel tops it


def plan(rear, front, half, corner):
    """Counter-clockwise plan outline with chamfered front corners, rear edge last."""
    return [
        (rear, -half),
        (front - corner, -half),
        (front, -half + corner),
        (front, half - corner),
        (front - corner, half),
        (rear, half),
    ]


def shell(p, shape, colour):
    hw = p["width"] / 2
    rear = p["frontX"] - p["cabLength"]
    z0, z2 = p["frameTop"], p["cabHeight"]
    z1 = z2 - ROOF
    low = plan(rear, p["frontX"], hw, CORNER)
    # Front-edge points slide back by ROOF; the rest stay, so every band quad is planar.
    high = [(x - ROOF if x > rear else x, y) for x, y in low]
    n = len(low)
    verts = [(x, y, z0) for x, y in low] + [(x, y, z1) for x, y in low]
    verts += [(x, y, z2) for x, y in high]
    faces = [tuple(reversed(range(n))), tuple(range(2 * n, 3 * n))]
    for ring in (0, n):
        for i in range(n):
            j = (i + 1) % n
            faces.append((ring + i, ring + j, ring + n + j, ring + n + i))
    shape.add(verts, faces, colour)


def front_fittings(p, shape, glass, hues):
    c, hw, front = p["cab"], p["width"] / 2, p["frontX"]
    relief = p["relief"]
    ahead = (front, front + relief)

    def above(sill, height):
        z = p["frameTop"] + sill
        return (z, z + height)

    glass_z = above(c["glassSill"], c["glassHeight"])
    ws = hw - c["windscreenInset"]
    glass.box(ahead, (-ws, ws), glass_z, hues["glass"])
    grille_y = (-c["grilleWidth"] / 2, c["grilleWidth"] / 2)
    if p["style"] == "day":
        black = c["grilleHeight"] * GRILLE_BLACK
        shape.box(ahead, grille_y, above(c["grilleSill"], black), hues["grille"])
        shape.box(ahead, grille_y, above(c["grilleSill"] + black, c["grilleHeight"] - black), hues["body"])
    else:
        shape.box(ahead, grille_y, above(c["grilleSill"], c["grilleHeight"]), hues["grille"])
    side_x = (
        front - c["sideGlassSetback"] - c["sideGlassLength"],
        front - c["sideGlassSetback"],
    )
    for side in (-1, 1):
        edge = (hw, hw + relief) if side > 0 else (-hw - relief, -hw)
        glass.box(side_x, edge, glass_z, hues["glass"])
        if p["style"] == "crew":
            gap, length = CREW_GLASS
            rear_x = (side_x[0] - gap - length, side_x[0] - gap)
            glass.box(rear_x, edge, glass_z, hues["glass"])
    half = hw - p["bumperInset"]
    # The front face sits at frontX + relief, where the plate expects it.
    face = front + relief
    shape.box((face - BUMPER_DEPTH, face), (-half, half), (p["railBottom"], p["frameTop"]), hues["white"])
    if p["style"] == "day":
        # sloped skid plate under the bumper; (z, x) pairs in the "zx" frame
        height, depth, skid = SKID
        rb = p["railBottom"]
        section = [(rb, face - depth), (rb, face - 0.02), (rb - height, face - 0.1), (rb - height, face - depth)]
        shape.prism(section, -skid, skid, hues["silver"], frame="zx")


def livery(p, shape, hues):
    hw, front = p["width"] / 2, p["frontX"]
    rear = front - p["cabLength"]
    relief, z0 = p["relief"], p["frameTop"]
    radius = p["wheelRadius"]
    angles, clearance = ARCH[p["style"]]
    # white lower front corners: the chamfers and the side panels just behind them
    corner_z = (z0, z0 + CORNER_HEIGHT)
    right = [(front - CORNER_LENGTH, -hw), (front - CORNER, -hw), (front, -hw + CORNER)]
    left = [(front, hw - CORNER), (front - CORNER, hw), (front - CORNER_LENGTH, hw)]
    for points in (right, left):
        for a, b in zip(points, points[1:]):
            shape.slab(a, b, relief, corner_z, hues["white"])
    line, gap = STRIPE_LINE
    stripe_x = (rear + 0.1, front - CORNER_LENGTH - 0.1)
    for side in (-1, 1):
        edge = (hw, hw + relief) if side > 0 else (-hw - relief, -hw)
        shape.box(stripe_x, edge, (z0 + STRIPE[0], z0 + STRIPE[0] + line), hues["white"])
        shape.box(stripe_x, edge, (z0 + STRIPE[0] + line + gap, z0 + STRIPE[1]), hues["white"])
        # white arch flares over the front wheels, outboard of the cab side
        shape.arch(
            (p["frontAxleX"], radius),
            (radius + clearance[0], radius + clearance[1]),
            angles,
            edge,
            hues["white"],
        )
        step_well(p, shape, hues, side, p["frontAxleX"] + radius + clearance[1] + STEP_CLEARANCE)


def step_well(p, shape, hues, side, x0):
    """The white box under the door, between the arch flare and the bumper, with two black treads; all of
    it inside the cab side, so the class V mirror sees the ground along that side."""
    hw = p["width"] / 2
    x1 = p["frontX"] - CORNER
    if x1 - x0 < 0.3:
        raise ValueError("no room for the step well between the arch and the bumper")
    depth, foot, inset = STEP_WELL
    face = hw - inset

    def lateral(a, b):
        return (a, b) if side > 0 else (-b, -a)

    shape.box((x0, x1), lateral(face - depth, face), (foot, p["frameTop"]), hues["white"])
    for z in STEP_TREADS:
        shape.box((x0 + 0.04, x1 - 0.04), lateral(face - 0.02, face + inset / 2), z, hues["black"])


def light_bar(p, shape, hues):
    """Segmented roof light bar: blue domes at the ends, a silver centre, on a black base."""
    front, z2 = p["frontX"], p["cabHeight"]
    half, depth, dome = BAR
    x1 = front - ROOF - BAR_SETBACK
    x = (x1 - depth, x1)
    shape.box(x, (-half, half), (z2, z2 + BEACON_BASE), hues["black"])
    top = (z2 + BEACON_BASE, z2 + BEACON_BASE + BEACON_HEIGHT)
    inner = (x[0] + 0.02, x[1] - 0.02)
    centre = half - 0.02 - dome - 0.02
    shape.box(inner, (-centre, centre), top, hues["silver"])
    for side in (-1, 1):
        y = (centre + 0.02, half - 0.02)
        shape.box(inner, y if side > 0 else (-y[1], -y[0]), top, hues["beacon"])
    radius, rail = GUARD_TUBE
    z = z2 + rail
    if p["style"] == "crew":
        # a tubular frame all round, on four legs
        gx, gy = (x[0] - 0.05, x[1] + 0.05), half + 0.05
        corners = [(gx[0], -gy), (gx[1], -gy), (gx[1], gy), (gx[0], gy)]
        for a, b in zip(corners, corners[1:] + corners[:1]):
            shape.tube((a[0], a[1], z), (b[0], b[1], z), radius, hues["silver"])
        for cx, cy in corners:
            shape.tube((cx, cy, z2), (cx, cy, z), radius, hues["silver"])
        return
    # the day cab's bar has a U-shaped grab guard round each end
    for side in (-1, 1):
        y_in, y_out = side * (half - 0.15), side * (half + 0.05)
        for gx in (x[0] - 0.04, x[1] + 0.04):
            shape.tube((gx, y_in, z), (gx, y_out, z), radius, hues["silver"])
            shape.tube((gx, y_out, z2), (gx, y_out, z), radius, hues["silver"])
        shape.tube((x[0] - 0.04, y_out, z), (x[1] + 0.04, y_out, z), radius, hues["silver"])


def roof(p, shape, hues):
    front, z2 = p["frontX"], p["cabHeight"]
    rear = front - p["cabLength"]
    light_bar(p, shape, hues)
    if p["style"] != "crew":
        return
    # roof rack: four legs, two rails, three cross bars
    x0, x1, y = rear + 0.45, rear + 1.45, 0.85
    bar, leg, top = 0.04, 0.05, z2 + 0.05 + 0.04
    for xs in (x0, x1 - bar):
        for ys in (-y, y - bar):
            shape.box((xs, xs + bar), (ys, ys + bar), (z2, z2 + 0.05), hues["silver"])
    for ys in (-y, y - bar):
        shape.box((x0, x1), (ys, ys + bar), (z2 + leg, top), hues["silver"])
    for xs in (x0, (x0 + x1 - bar) / 2, x1 - bar):
        shape.box((xs, xs + bar), (-y, y), (z2 + leg, top), hues["silver"])


def tow_coupling(p, shape, hues):
    front, relief = p["frontX"], p["relief"]
    shape.box(
        (front - 0.05, front + relief + 0.06),
        (-0.1, 0.1),
        (0.42, 0.6),
        hues["black"],
    )
    shape.box(
        (front + relief + 0.06, front + relief + 0.2),
        (-0.04, 0.04),
        (0.46, 0.56),
        hues["black"],
    )


def check_envelope(p, *shapes):
    """The cab stays behind the body and clear of the plate: only the tow coupling stands ahead of the bumper face."""
    rear = p["frontX"] - p["cabLength"]
    face = p["frontX"] + p["relief"]
    for (x0, x1), _, (z0, z1) in (e for shape in shapes for e in shape.extents()):
        if x0 < rear - EPS:
            raise ValueError("a face reaches behind the cab")
        if x1 > face + EPS and z1 > p["railBottom"] + EPS:
            raise ValueError("a face stands ahead of the bumper face above the plate's rail line")


def check_lenses(p, shape, lens):
    """Each lens sits on a face of the cab and stays behind the plate's face."""
    LAMP["check_seated"](shape, p["lenses"])
    for (x0, x1), _, _ in lens.extents():
        if x1 > p["frontX"] + p["plateRelief"] - EPS:
            raise ValueError("a lamp lens reaches the plate's face")
        if x0 < p["frontX"] - p["cabLength"] - EPS:
            raise ValueError("a lamp lens reaches behind the cab")


def main():
    params = COMMON["load_params"](globals())
    if params["relief"] >= params["plateRelief"]:
        raise ValueError("the bumper face must stay behind the plate")
    if params["style"] not in ("day", "crew"):
        raise ValueError("unknown cab style " + repr(params["style"]))
    hashes = COMMON["provenance"](
        __file__, {"commonSha256": COMMON_FILE, "lampCommonSha256": LAMP_FILE}, params
    )
    COMMON["check_expected"](hashes, globals().get("EXPECTED_SHA256"))
    hues = {key: srgb(value) for key, value in sorted(params["hues"].items())}

    shape, glass = Shape(), Shape()
    shell(params, shape, hues["body"])
    front_fittings(params, shape, glass, hues)
    livery(params, shape, hues)
    roof(params, shape, hues)
    if params["style"] == "crew":
        tow_coupling(params, shape, hues)
    check_envelope(params, shape, glass)
    lens = LAMP["lens_shape"](params["lenses"])
    check_lenses(params, shape, lens)
    return COMMON["export"](OUT_PATH, "cab-shell", hashes, [("cab", shape), ("cab-glass", glass), ("cab-lens", lens)])


RESULT = main()
