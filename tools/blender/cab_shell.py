"""Generic truck cab shell for the Gegenlenker mirrors (issue #68).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/<id>.cab.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH (for hosts that cannot read the path)
  OUT_PATH     where the raw .glb is written

Authored in the sim body frame: metres, +X forward, +Y left, +Z up, origin at the rear axle. The
glTF exporter's default Y-up conversion then yields Three space (x = x, z = -y).

Tested Blender version: 5.3.0 (bpy.app.version_string is printed and recorded in the manifest).
No read_factory_settings: it also reloads preferences and disables add-ons, such as the host's MCP add-on.
Deterministic: fixed names, ordered lists, no clock or randomness.
"""

import json
import os

import bpy

CORNER = 0.12  # vertical front edges are chamfered by this much (<= every glass/lamp inset)
ROOF = 0.12  # the roof's front edge drops and recedes by this much
BUMPER_DEPTH = 0.15

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
    "export_extras": False,
    "export_cameras": False,
    "export_lights": False,
    "export_animations": False,
    "export_skins": False,
    "export_morph": False,
    "export_draco_mesh_compression_enable": False,
}


def srgb_to_linear(hex_colour):
    out = []
    for i in (1, 3, 5):
        c = int(hex_colour[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out + [1.0]


class Shape:
    """Indexed polygons with one colour per face."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.colours = []

    def add(self, verts, faces, colour):
        base = len(self.verts)
        self.verts.extend(verts)
        for face in faces:
            self.faces.append(tuple(base + i for i in face))
            self.colours.append(colour)

    def box(self, x, y, z, colour):
        (x0, x1), (y0, y1), (z0, z1) = x, y, z
        verts = [
            (x0, y0, z0),
            (x1, y0, z0),
            (x1, y1, z0),
            (x0, y1, z0),
            (x0, y0, z1),
            (x1, y0, z1),
            (x1, y1, z1),
            (x0, y1, z1),
        ]
        faces = [
            (3, 2, 1, 0),
            (4, 5, 6, 7),
            (0, 1, 5, 4),
            (1, 2, 6, 5),
            (2, 3, 7, 6),
            (3, 0, 4, 7),
        ]
        self.add(verts, faces, colour)


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


def shell(p):
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
    shape = Shape()
    shape.add(verts, faces, [1.0, 1.0, 1.0, 1.0])
    return shape


def fittings(p):
    c, hw, front = p["cab"], p["width"] / 2, p["frontX"]
    glass = srgb_to_linear(p["hues"]["glass"])
    grille = srgb_to_linear(p["hues"]["grille"])
    lamp = srgb_to_linear(p["hues"]["lamp"])
    bumper = srgb_to_linear(p["hues"]["bumper"])
    relief = p["relief"]
    ahead = (front, front + relief)

    def above(sill, height):
        z = p["frameTop"] + sill
        return (z, z + height)

    glass_z = above(c["glassSill"], c["glassHeight"])
    lamp_z = above(c["lampSill"], c["lampHeight"])
    shape = Shape()
    ws = hw - c["windscreenInset"]
    shape.box(ahead, (-ws, ws), glass_z, glass)
    shape.box(
        ahead,
        (-c["grilleWidth"] / 2, c["grilleWidth"] / 2),
        above(c["grilleSill"], c["grilleHeight"]),
        grille,
    )
    outer = hw - c["headlampInset"]
    inner = outer - c["headlampWidth"]
    side_x = (
        front - c["sideGlassSetback"] - c["sideGlassLength"],
        front - c["sideGlassSetback"],
    )
    for side in (-1, 1):
        lateral = (inner, outer) if side > 0 else (-outer, -inner)
        shape.box(ahead, lateral, lamp_z, lamp)
        edge = (hw, hw + relief) if side > 0 else (-hw - relief, -hw)
        shape.box(side_x, edge, glass_z, glass)
    half = hw - p["bumperInset"]
    # The front face sits at frontX + relief, where the plate expects it.
    shape.box(
        (front + relief - BUMPER_DEPTH, front + relief),
        (-half, half),
        (p["railBottom"], p["frameTop"]),
        bumper,
    )
    return shape


def reset_scene():
    """One empty scene and no leftover datablocks; preferences and add-ons stay untouched."""
    window = bpy.context.window
    keep = bpy.context.scene
    if window is not None:
        keep = bpy.data.scenes.new("cab-shell")
        window.scene = keep
    for scene in list(bpy.data.scenes):
        if scene != keep:
            bpy.data.scenes.remove(scene)
    keep.name = "cab-shell"
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


def add_object(name, shape, mat, colours):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(shape.verts, [], shape.faces)
    mesh.update()
    mesh.validate()
    if colours:
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
    options = {k: v for k, v in sorted(GLTF_OPTIONS.items()) if k in known}
    dropped = sorted(k for k in GLTF_OPTIONS if k not in known)
    return dict(options, filepath=out_path), dropped


def main():
    if globals().get("PARAMS_JSON"):
        params = json.loads(PARAMS_JSON)
    else:
        with open(PARAMS_PATH, encoding="utf-8") as f:
            params = json.load(f)
    if params["relief"] >= params["plateRelief"]:
        raise ValueError("the bumper face must stay behind the plate")
    out_path = OUT_PATH
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

    reset_scene()
    add_object("cab-body", shell(params), material("cab-body"), colours=False)
    add_object("cab-detail", fittings(params), material("cab-detail"), colours=True)
    options, dropped = export_options(out_path)
    bpy.ops.export_scene.gltf(**options)

    result = {
        "out": out_path,
        "blender": bpy.app.version_string,
        "unsupportedExportOptions": dropped,
    }
    print(json.dumps(result, sort_keys=True))
    return result


RESULT = main()
