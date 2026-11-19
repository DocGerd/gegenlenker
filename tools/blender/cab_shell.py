"""THW truck cab shell for the Gegenlenker mirrors (issues #68, #133).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/<id>.cab.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH (for hosts that cannot read the path)
  OUT_PATH     where the raw .glb is written
  EXPECTED_SHA256  optional {"scriptSha256": ..., "commonSha256": ...}; the run aborts on a mismatch

Two vertex-coloured meshes in the sim body frame (shell_common.py): "cab", and "cab-lens" with the
lamp lenses of `lenses` (src/render/lamp-layout.ts). Livery is colours only: no lettering, emblems or
maker logos. Styles: "day" (short day cab) and "crew" (double cab with a second
side window row, a roof rack and a front tow coupling).

Tested Blender version: 5.3.0 (bpy.app.version_string is printed and recorded in the manifest).
"""

import os
import runpy

COMMON_FILE = os.path.join(os.path.dirname(__file__), "shell_common.py")
COMMON = runpy.run_path(COMMON_FILE)
Shape = COMMON["Shape"]
srgb = COMMON["srgb_to_linear"]

EPS = 1e-6
CORNER = 0.12  # vertical front edges are chamfered by this much (<= every glass/lamp inset)
ROOF = 0.12  # the roof's front edge drops and recedes by this much
BUMPER_DEPTH = 0.15
CORNER_LENGTH = 0.5  # white lower front corner wraps this far back along each side
CORNER_HEIGHT = 0.5
STRIPE = (0.62, 0.76)  # side stripe, above the frame top
CREW_GLASS = (0.2, 0.75)  # pillar gap and length of the second side window
ARCH_ANGLES = (35, 145)
ARCH_CLEARANCE = (0.06, 0.14)  # inner and outer radius beyond the tyre
BEACON_BASE = 0.04
BEACON_HEIGHT = 0.1


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


def front_fittings(p, shape, hues):
    c, hw, front = p["cab"], p["width"] / 2, p["frontX"]
    relief = p["relief"]
    ahead = (front, front + relief)

    def above(sill, height):
        z = p["frameTop"] + sill
        return (z, z + height)

    glass_z = above(c["glassSill"], c["glassHeight"])
    ws = hw - c["windscreenInset"]
    shape.box(ahead, (-ws, ws), glass_z, hues["glass"])
    shape.box(
        ahead,
        (-c["grilleWidth"] / 2, c["grilleWidth"] / 2),
        above(c["grilleSill"], c["grilleHeight"]),
        hues["grille"],
    )
    side_x = (
        front - c["sideGlassSetback"] - c["sideGlassLength"],
        front - c["sideGlassSetback"],
    )
    for side in (-1, 1):
        edge = (hw, hw + relief) if side > 0 else (-hw - relief, -hw)
        shape.box(side_x, edge, glass_z, hues["glass"])
        if p["style"] == "crew":
            gap, length = CREW_GLASS
            rear_x = (side_x[0] - gap - length, side_x[0] - gap)
            shape.box(rear_x, edge, glass_z, hues["glass"])
    half = hw - p["bumperInset"]
    # The front face sits at frontX + relief, where the plate expects it.
    shape.box(
        (front + relief - BUMPER_DEPTH, front + relief),
        (-half, half),
        (p["railBottom"], p["frameTop"]),
        hues["white"],
    )


def livery(p, shape, hues):
    hw, front = p["width"] / 2, p["frontX"]
    rear = front - p["cabLength"]
    relief, z0 = p["relief"], p["frameTop"]
    # white lower front corners: the chamfers and the side panels just behind them
    corner_z = (z0, z0 + CORNER_HEIGHT)
    right = [(front - CORNER_LENGTH, -hw), (front - CORNER, -hw), (front, -hw + CORNER)]
    left = [(front, hw - CORNER), (front - CORNER, hw), (front - CORNER_LENGTH, hw)]
    for points in (right, left):
        for a, b in zip(points, points[1:]):
            shape.slab(a, b, relief, corner_z, hues["white"])
    stripe_z = (z0 + STRIPE[0], z0 + STRIPE[1])
    for side in (-1, 1):
        edge = (hw, hw + relief) if side > 0 else (-hw - relief, -hw)
        shape.box((rear + 0.1, front - CORNER_LENGTH - 0.1), edge, stripe_z, hues["white"])
        # white arches over the front wheels, outboard of the cab side
        radius = p["wheelRadius"]
        shape.arch(
            (p["frontAxleX"], radius),
            (radius + ARCH_CLEARANCE[0], radius + ARCH_CLEARANCE[1]),
            ARCH_ANGLES,
            edge,
            hues["white"],
        )


def roof(p, shape, hues):
    front, z2 = p["frontX"], p["cabHeight"]
    rear = front - p["cabLength"]
    crew = p["style"] == "crew"
    half = 0.6 if crew else 0.55
    x = (front - ROOF - 1.05, front - ROOF - 0.8)
    shape.box(x, (-half, half), (z2, z2 + BEACON_BASE), hues["black"])
    shape.box(
        (x[0] + 0.02, x[1] - 0.02),
        (-half + 0.04, half - 0.04),
        (z2 + BEACON_BASE, z2 + BEACON_BASE + BEACON_HEIGHT),
        hues["beacon"],
    )
    if not crew:
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


def check_envelope(p, shape):
    """The cab stays behind the body and clear of the plate: only the tow coupling stands ahead of the bumper face."""
    rear = p["frontX"] - p["cabLength"]
    face = p["frontX"] + p["relief"]
    for (x0, x1), _, (z0, z1) in shape.extents():
        if x0 < rear - EPS:
            raise ValueError("a face reaches behind the cab")
        if x1 > face + EPS and z1 > p["railBottom"] + EPS:
            raise ValueError("a face stands ahead of the bumper face above the plate's rail line")


def check_lenses(p, shape, lens):
    """Each lens sits on a face of the cab and stays behind the plate's face."""
    COMMON["check_seated"](shape, p["lenses"])
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
    hashes = COMMON["provenance"](__file__, COMMON_FILE, params)
    COMMON["check_expected"](hashes, globals().get("EXPECTED_SHA256"))
    hues = {key: srgb(value) for key, value in sorted(params["hues"].items())}

    shape = Shape()
    shell(params, shape, hues["body"])
    front_fittings(params, shape, hues)
    livery(params, shape, hues)
    roof(params, shape, hues)
    if params["style"] == "crew":
        tow_coupling(params, shape, hues)
    check_envelope(params, shape)
    lens = COMMON["lens_shape"](params["lenses"])
    check_lenses(params, shape, lens)
    return COMMON["export"](OUT_PATH, "cab-shell", hashes, [("cab", shape), ("cab-lens", lens)])


RESULT = main()
