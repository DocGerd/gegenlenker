"""Helpers shared by the Gegenlenker glb shell scripts (cab_shell.py, body_shell.py; issue #133).

Loaded by the entry scripts with runpy.run_path, never imported: the host's MCP session caches modules.
Authored in the sim body frame: metres, +X forward, +Y left, +Z up. The glTF exporter's default Y-up
conversion yields Three space (x = x, z = -y).

No read_factory_settings: it also reloads preferences and disables add-ons, such as the host's MCP add-on.
Deterministic: fixed names, ordered lists, vertices rounded to 1e-6, no clock or randomness.
"""

import hashlib
import json
import math
import os

import bpy

KNOWN_SCENES = ("cab-shell", "body-shell")
DECIMALS = 6

GLTF_OPTIONS = {
    "export_format": "GLB",
    "use_active_scene": True,
    "use_selection": False,
    "export_apply": True,
    "export_yup": True,
    "export_materials": "EXPORT",
    "export_normals": True,
    "export_texcoords": False,
    "export_tangents": False,
    "export_vertex_color": "ACTIVE",
    "export_active_vertex_color_when_no_material": True,
    "export_all_vertex_colors": False,
    "export_attributes": False,
    "export_image_format": "NONE",
    "export_extras": True,
    "export_cameras": False,
    "export_lights": False,
    "export_animations": False,
    "export_skins": False,
    "export_morph": False,
    "export_draco_mesh_compression_enable": False,
}

# A missing one changes the output (axis, normals, colours, provenance), so it is an error.
REQUIRED_OPTIONS = (
    "export_format",
    "export_yup",
    "export_vertex_color",
    "export_normals",
    "export_apply",
    "export_extras",
    "use_active_scene",
)

# (u, v, w) -> (x, y, z); every frame is right-handed, so u x v = +w.
FRAMES = {
    "xy": lambda u, v, w: (u, v, w),
    "zx": lambda u, v, w: (v, w, u),
    "yz": lambda u, v, w: (w, u, v),
}


def srgb_to_linear(hex_colour):
    out = []
    for i in (1, 3, 5):
        c = int(hex_colour[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return [round(c, DECIMALS) for c in out] + [1.0]


def signed_area(poly):
    total = 0.0
    for i, (u0, v0) in enumerate(poly):
        u1, v1 = poly[(i + 1) % len(poly)]
        total += u0 * v1 - u1 * v0
    return total / 2


class Shape:
    """Indexed polygons with one colour per face. Only convex, planar faces: no triangulation guesses."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.colours = []

    def add(self, verts, faces, colour):
        base = len(self.verts)
        self.verts.extend(tuple(round(c, DECIMALS) for c in v) for v in verts)
        for face in faces:
            self.faces.append(tuple(base + i for i in face))
            self.colours.append(colour)

    def prism(self, poly, w0, w1, colour, frame="xy"):
        """Convex polygon (u, v) extruded from w0 to w1 along the frame's third axis."""
        area = signed_area(poly)
        if abs(area) < 1e-9:
            raise ValueError("degenerate prism")
        if area < 0:
            poly = list(reversed(poly))
        place = FRAMES[frame]
        n = len(poly)
        verts = [place(u, v, w0) for u, v in poly] + [place(u, v, w1) for u, v in poly]
        faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
        self.add(verts, faces, colour)

    def box(self, x, y, z, colour):
        (x0, x1), (y0, y1), (z0, z1) = x, y, z
        self.prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, colour)

    def slab(self, p, q, outward, z, colour):
        """Plan segment p -> q thickened by `outward` (to its right, for a counter-clockwise outline)."""
        dx, dy = q[0] - p[0], q[1] - p[1]
        length = math.hypot(dx, dy)
        nx, ny = dy / length * outward, -dx / length * outward
        self.prism([p, (p[0] + nx, p[1] + ny), (q[0] + nx, q[1] + ny), q], z[0], z[1], colour)

    def arch(self, centre, radii, angles, y, colour, segments=8):
        """Wheel arch: a half ring in the x-z plane around centre = (x, z), lateral range y."""
        r0, r1 = radii
        a0, a1 = angles
        points = []
        for i in range(segments + 1):
            a = math.radians(a0 + (a1 - a0) * i / segments)
            points.append((math.cos(a), math.sin(a)))
        for i in range(segments):
            (c0, s0), (c1, s1) = points[i], points[i + 1]
            # the "zx" frame takes (z, x) pairs and extrudes along y
            poly = [
                (centre[1] + r0 * s0, centre[0] + r0 * c0),
                (centre[1] + r1 * s0, centre[0] + r1 * c0),
                (centre[1] + r1 * s1, centre[0] + r1 * c1),
                (centre[1] + r0 * s1, centre[0] + r0 * c1),
            ]
            self.prism(poly, y[0], y[1], colour, frame="zx")


def reset_scene(name):
    """One empty scene called `name` and no leftover datablocks; preferences and add-ons stay untouched."""
    if name not in KNOWN_SCENES:
        raise ValueError("unknown scene name " + name)
    if bpy.data.filepath:
        raise RuntimeError("refusing to reset a saved session: " + bpy.data.filepath)
    if bpy.data.is_dirty and any(s.name not in KNOWN_SCENES for s in bpy.data.scenes):
        raise RuntimeError("refusing to reset a session with unsaved work")
    window = bpy.context.window
    keep = bpy.context.scene
    if window is not None:
        keep = bpy.data.scenes.new(name)
        window.scene = keep
    for scene in list(bpy.data.scenes):
        if scene != keep:
            bpy.data.scenes.remove(scene)
    keep.name = name
    for blocks in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.collections,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.images,
        bpy.data.actions,
        bpy.data.node_groups,
        bpy.data.curves,
    ):
        for block in list(blocks):
            blocks.remove(block)


def material(name):
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF") if mat.node_tree else None
    if node is not None:
        node.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        node.inputs["Metallic"].default_value = 0.0
        node.inputs["Roughness"].default_value = 1.0
    return mat


def add_object(name, shape, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(shape.verts, [], shape.faces)
    mesh.update()
    mesh.validate()
    attr = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    flat = []
    for face, colour in zip(shape.faces, shape.colours):
        flat.extend(colour * len(face))
    attr.data.foreach_set("color", flat)
    mesh.color_attributes.active_color = attr
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)


def export_options(out_path):
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    missing = [k for k in REQUIRED_OPTIONS if k not in known]
    if missing:
        raise RuntimeError("this Blender lacks glTF export options: " + ", ".join(missing))
    options = {k: v for k, v in sorted(GLTF_OPTIONS.items()) if k in known}
    dropped = sorted(k for k in GLTF_OPTIONS if k not in known)
    return dict(options, filepath=out_path), dropped


def file_sha256(path):
    """LF-normalised, as tools/blender/glb-build.ts hashes scripts."""
    with open(path, "rb") as f:
        return hashlib.sha256(f.read().replace(b"\r\n", b"\n")).hexdigest()


def provenance(entry_file, common_file, params):
    """Hashes of both scripts and the params, as glb-build.ts computes them.

    The params hash relies on json.dumps and JSON.stringify printing the same numbers: the params
    hold no float below 1e-4 and no whole float, which glb-build.test.ts checks.
    """
    canonical = json.dumps(params, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {
        "commonSha256": file_sha256(common_file),
        "paramsSha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "scriptSha256": file_sha256(entry_file),
    }


def check_expected(hashes, expected):
    """Abort when a script differs from the hashes the caller read before launching it."""
    for key, want in (expected or {}).items():
        if hashes[key] != want:
            raise RuntimeError("%s is %s, expected %s" % (key, hashes[key], want))


def load_params(init):
    if init.get("PARAMS_JSON"):
        return json.loads(init["PARAMS_JSON"])
    with open(init["PARAMS_PATH"], encoding="utf-8") as f:
        return json.load(f)


def export(out_path, scene_name, hashes, objects):
    """Build the scene from [(name, shape)] and write the glb; returns the result record."""
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    reset_scene(scene_name)
    for key, value in hashes.items():
        bpy.context.scene[key] = value
    for name, shape in objects:
        add_object(name, shape, material(name))
    options, dropped = export_options(out_path)
    if os.path.exists(out_path):
        os.remove(out_path)
    status = bpy.ops.export_scene.gltf(**options)
    if status != {"FINISHED"} or not os.path.isfile(out_path):
        raise RuntimeError("glTF export did not write " + out_path + ": " + repr(status))
    result = {
        "out": out_path,
        "blender": bpy.app.version_string,
        "unsupportedExportOptions": dropped,
        **hashes,
    }
    print(json.dumps(result, sort_keys=True))
    return result
