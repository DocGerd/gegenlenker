"""Lamp helpers for the Gegenlenker vehicle shells (cab_shell.py, body_shell.py, trailer_shell.py; issues #133, #198).

Loaded with runpy.run_path, never imported. Builds on blender_common.py and takes the lamp layout from
tools/blender/params (src/render/lamp-layout.ts).
"""

import math
import os
import runpy

COMMON = runpy.run_path(os.path.join(os.path.dirname(__file__), "blender_common.py"))
Shape = COMMON["Shape"]
srgb_to_linear = COMMON["srgb_to_linear"]

# The face a lens stands on, per facing: (axis, which end of the lens box, the other two axes).
BACKS = {"front": (0, 0, (1, 2)), "rear": (0, 1, (1, 2)), "left": (1, 0, (0, 2)), "right": (1, 1, (0, 2))}
SEAT_SAMPLES = (0.01, 0.5, 0.99)


def lens_shape(lenses):
    """The lamp lenses of tools/blender/params (src/render/lamp-layout.ts), one box each in its unlit hue."""
    shape = Shape()
    for lens in lenses:
        (x, y, z) = lens["box"]
        shape.box(x, y, z, srgb_to_linear(lens["hue"]))
    return shape


def inside_convex(poly, point, tol=1e-6):
    """Whether a 2D point lies in the convex polygon, within tol."""
    signs = set()
    for (u0, v0), (u1, v1) in zip(poly, poly[1:] + poly[:1]):
        length = math.hypot(u1 - u0, v1 - v0)
        if length < 1e-12:
            continue
        cross = ((u1 - u0) * (point[1] - v0) - (v1 - v0) * (point[0] - u0)) / length
        if abs(cross) > tol:
            signs.add(cross > 0)
    return len(signs) < 2


def check_seated(shape, lenses, eps=1e-6):
    """Every lens's back face lies on faces of `shape`: no lamp floats off the surface it sits on."""
    for lens in lenses:
        axis, end, (a, b) = BACKS[lens["facing"]]
        plane = lens["box"][axis][end]
        faces = []
        for face in shape.faces:
            points = [shape.verts[i] for i in face]
            if all(abs(p[axis] - plane) < eps for p in points):
                faces.append([(p[a], p[b]) for p in points])
        (a0, a1), (b0, b1) = lens["box"][a], lens["box"][b]
        for fa in SEAT_SAMPLES:
            for fb in SEAT_SAMPLES:
                point = (a0 + (a1 - a0) * fa, b0 + (b1 - b0) * fb)
                if not any(inside_convex(poly, point) for poly in faces):
                    raise ValueError("lamp %s has no surface to sit on" % lens["id"])
