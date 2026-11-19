"""Baked cockpit interior atlases for the Gegenlenker cockpit view (issue #159).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/cockpit-interior.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH
  SOURCES_DIR  directory holding the CC0 source JPGs at the paths the params list (hash-checked)
  OUT_DIR      where the raw atlases and the bake's EXR passes are written
  EXPECTED_SHA256  optional {"scriptSha256", "commonSha256", "kitCommonSha256"}; the run aborts on a mismatch
  KEEP_SCENE   optional; True leaves the modelled interior for inspection

The interior is modelled in the cockpit eye's frame (metres; the camera looks along -Z, +Y up, +X
right), with every silhouette edge built along the view rays of the NDC contracts in
src/render/cockpit-interior.ts at the bake aspect. Cycles renders emission-only passes from the eye
(albedo, view-space normal, roughness, AO, sun-reachable), which are resampled into the regions of
src/render/cockpit-bake-dims.ts. Writes, as top-down RGBA8: cockpit-atlas-a (sRGB albedo),
cockpit-atlas-b (view normal x, view normal y, roughness, AO; linear) and cockpit-atlas-m (sun
reachable, coverage; linear, half size).

CPU Cycles with a fixed seed, no adaptive sampling and no denoiser renders bit-identical passes.
Tested Blender version: 5.3.0.
"""

import math
import os
import runpy

import bpy
import numpy as np

KIT_FILE = os.path.join(os.path.dirname(__file__), "kit_common.py")
KIT = runpy.run_path(KIT_FILE)
box = KIT["box"]
srgb = KIT["srgb_to_linear"]
srgb_decode = KIT["srgb_decode"]
srgb_encode = KIT["srgb_encode"]

PASSES = ("albedo", "normal", "roughness", "occlusion", "sun")
PX = 800  # render texels per NDC y unit at scale 1
DETAIL_SCALE = 2  # the visor and pillar render at this multiple, in a border crop

# Interior layout in the eye frame (render estimates).
DASH_FAR = 1.25  # windscreen base, where the dash top meets the glass
DASH_NEAR = 0.55
DASH_DROP = 0.14  # the dash top falls this much towards the driver
FASCIA_BOTTOM = -0.8
WINDSCREEN_TOP = 1.05
ROOF = 0.52
ROOF_NEAR = 0.2
X_REACH = 1.16  # NDC x, past the overscan


class Builder:
    """One mesh with per-face material keys and per-vertex UVs in metres / tile."""

    def __init__(self, name, sun):
        self.name, self.sun = name, sun
        self.verts, self.faces, self.keys, self.uvs = [], [], [], []

    def _faces_away(self, face, inside=None):
        """Whether a face's winding points away from the eye (or, with `inside`, into the solid)."""
        points = [self.verts[i] for i in face]
        normal = KIT["face_normal"](points)
        centre = np.mean(points, axis=0)
        if inside is None:
            return float(np.dot(normal, centre)) > 0
        return float(np.dot(normal, centre - np.array(inside))) < 0

    def grid(self, rows, keys):
        """rows[i][j] = (point, (s, t) metres); keys(i, j) names the quad between rows i, i+1 and columns j, j+1.
        The whole grid is wound to face the eye, judged at its middle quad."""
        base = len(self.verts)
        n = len(rows[0])
        for row in rows:
            for point, st in row:
                self.verts.append(tuple(float(c) for c in point))
                self.uvs.append(st)
        faces = []
        for i in range(len(rows) - 1):
            for j in range(n - 1):
                a = base + i * n + j
                faces.append((a, a + 1, a + n + 1, a + n))
                self.keys.append(keys(i, j))
        if self._faces_away(faces[len(faces) // 2]):
            faces = [tuple(reversed(f)) for f in faces]
        self.faces.extend(faces)

    def quad(self, corners, key, inside=None):
        """A flat quad with planar UVs in metres, facing the eye or away from `inside`."""
        base = len(self.verts)
        u = np.subtract(corners[1], corners[0])
        v = np.subtract(corners[3], corners[0])
        lu, lv = float(np.linalg.norm(u)), float(np.linalg.norm(v))
        for p, st in zip(corners, ((0, 0), (lu, 0), (lu, lv), (0, lv))):
            self.verts.append(tuple(float(c) for c in p))
            self.uvs.append(st)
        face = (base, base + 1, base + 2, base + 3)
        self.faces.append(tuple(reversed(face)) if self._faces_away(face, inside) else face)
        self.keys.append(key)

    def block(self, centre, axes, half, key):
        """A box around centre with orthonormal axes (a, b, c) and half extents."""
        corners = {}
        for sa in (-1, 1):
            for sb in (-1, 1):
                for sc in (-1, 1):
                    corners[(sa, sb, sc)] = tuple(
                        centre[k] + sa * half[0] * axes[0][k] + sb * half[1] * axes[1][k] + sc * half[2] * axes[2][k]
                        for k in range(3)
                    )
        for axis in range(3):
            for sign in (-1, 1):
                others = [i for i in range(3) if i != axis]
                quad = []
                for s0, s1 in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    key3 = [0, 0, 0]
                    key3[axis], key3[others[0]], key3[others[1]] = sign, s0, s1
                    quad.append(corners[tuple(key3)])
                self.quad(quad, key, inside=centre)

    def build(self, materials, tiles):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        if mesh.validate():
            raise RuntimeError(self.name + ": mesh.validate() repaired the geometry")
        used = sorted(set(self.keys))
        for key in used:
            mesh.materials.append(materials[key])
        mesh.polygons.foreach_set("material_index", [used.index(k) for k in self.keys])
        mesh.polygons.foreach_set("use_smooth", [True] * len(self.faces))
        uv = mesh.uv_layers.new(name="UVMap")
        flat = []
        for face, key in zip(self.faces, self.keys):
            for i in face:
                s, t = self.uvs[i]
                flat.extend((s / tiles[key], t / tiles[key]))
        uv.data.foreach_set("uv", flat)
        obj = bpy.data.objects.new(self.name, mesh)
        obj["sun"] = float(self.sun)
        bpy.context.scene.collection.objects.link(obj)
        return obj


class Eye:
    """Rays of the bake view: NDC (x, y) at the bake aspect -> eye-frame point at depth d."""

    def __init__(self, p):
        self.tan = math.tan(math.radians(p["fov"] / 2))
        self.aspect = p["aspect"]
        self.dash = lambda x: p["dash"]["centre"] + p["dash"]["curve"] * x * x
        self.header = lambda x: p["header"]["centre"] + p["header"]["curve"] * x * x

    def at(self, x, y, d):
        return (x * self.aspect * self.tan * d, y * self.tan * d, -d)

    def ndc_x(self, px, d):
        return px / (self.aspect * self.tan * d)


def columns(eye, n=49):
    return [-X_REACH + 2 * X_REACH * j / (n - 1) for j in range(n)]


def dash(eye, p):
    """Dash top from the windscreen base towards the driver, then the fascia down; the far edge lies on dashEdge."""
    b = Builder("dash", 1)
    rows = []
    depths = [DASH_FAR, DASH_FAR - 0.08, DASH_FAR - 0.12, 1.0, 0.85, 0.72, 0.62, DASH_NEAR + 0.02, DASH_NEAR]
    for i, d in enumerate(depths):
        row = []
        for x in columns(eye):
            far = eye.at(x, eye.dash(x), DASH_FAR)
            f = (DASH_FAR - d) / (DASH_FAR - DASH_NEAR)
            y = far[1] - DASH_DROP * f * f - (0.02 if i == len(depths) - 1 else 0)
            row.append(((far[0], y, -d), (far[0], DASH_FAR - d)))
        rows.append(row)
    for z in (0.08, 0.3):  # rounded front edge, then the fascia
        row = []
        for x in columns(eye):
            far = eye.at(x, eye.dash(x), DASH_FAR)
            y = far[1] - DASH_DROP - 0.02 - z
            row.append(((far[0], y if z < 0.3 else FASCIA_BOTTOM, -(DASH_NEAR - 0.02)), (far[0], DASH_FAR - DASH_NEAR + z)))
        rows.append(row)
    b.grid(rows, lambda i, j: "trim" if i == 0 else "dash")
    return b


def hood(eye):
    """Instrument hood in front of the driver; its back edge stays just under dashEdge."""
    b = Builder("hood", 1)
    half = 0.32
    back = DASH_FAR - 0.3
    top = eye.dash(0.0) * eye.tan * back - 0.012
    xs = [-half - 0.08] + [-half + 2 * half * k / 12 for k in range(13)] + [half + 0.08]
    rows = []
    for d, drop in ((back, 0.0), (0.8, 0.012), (0.68, 0.03), (0.66, 0.08), (0.66, 0.2)):
        row = []
        for x in xs:
            # the outer columns skirt down to the dash top, so nothing shows under the hood
            y = -0.42 if abs(x) > half else top - drop - 0.05 * (x / half) ** 2
            row.append(((x, y, -d), (x, back - d + drop)))
        rows.append(row)
    b.grid(rows, lambda i, j: "dash")
    return b


def dash_details(eye):
    """Defroster slots near the glass and two speaker grilles in the corners."""
    b = Builder("dash-details", 0)
    for x in (-0.9, -0.45, 0.0, 0.45, 0.9):
        d0, d1 = DASH_FAR - 0.13, DASH_FAR - 0.105
        y0 = eye.at(eye.ndc_x(x, DASH_FAR), eye.dash(eye.ndc_x(x, DASH_FAR)), DASH_FAR)[1]
        y = lambda d: y0 - DASH_DROP * ((DASH_FAR - d) / (DASH_FAR - DASH_NEAR)) ** 2 + 0.002
        b.quad([(x - 0.15, y(d0), -d0), (x + 0.15, y(d0), -d0), (x + 0.15, y(d1), -d1), (x - 0.15, y(d1), -d1)], "grille")
    for x in (-1.0, 1.0):
        d0, d1 = 1.08, 0.95
        y0 = eye.at(eye.ndc_x(x, DASH_FAR), eye.dash(eye.ndc_x(x, DASH_FAR)), DASH_FAR)[1]
        y = lambda d: y0 - DASH_DROP * ((DASH_FAR - d) / (DASH_FAR - DASH_NEAR)) ** 2 + 0.002
        b.quad([(x - 0.09, y(d0), -d0), (x + 0.09, y(d0), -d0), (x + 0.09, y(d1), -d1), (x - 0.09, y(d1), -d1)], "grille")
    return b


def wipers(eye):
    """Parked wiper arms outside the glass, just above the dash line (coverage marks them)."""
    b = Builder("wipers", 0)
    d = DASH_FAR + 0.2
    for x0, x1 in ((-0.62, -0.06), (0.08, 0.64)):
        a = eye.at(x0, eye.dash(x0) + 0.012, d)
        c = eye.at(x1, eye.dash(x1) + 0.03, d)
        mid = tuple((a[k] + c[k]) / 2 for k in range(3))
        along = np.subtract(c, a)
        length = float(np.linalg.norm(along))
        ax = tuple(float(v) for v in along / length)
        up = (0.0, 1.0, 0.0)
        side = tuple(float(v) for v in np.cross(ax, up))
        side_n = float(np.linalg.norm(side))
        side = tuple(v / side_n for v in side)
        up = tuple(float(v) for v in np.cross(side, ax))
        b.block(mid, (ax, up, side), (length / 2, 0.008, 0.008), "seal")
    return b


def header(eye):
    """Roof lining from the windscreen top (on headerEdge) back over the driver; the seal runs along the glass."""
    b = Builder("header", 0)
    rows = []
    depths = [WINDSCREEN_TOP, WINDSCREEN_TOP - 0.02, 0.95, 0.8, 0.6, 0.4, ROOF_NEAR]
    for d in depths:
        row = []
        for x in columns(eye):
            edge = eye.at(x, eye.header(x), WINDSCREEN_TOP)
            f = (WINDSCREEN_TOP - d) / (WINDSCREEN_TOP - ROOF_NEAR)
            y = edge[1] + (ROOF - edge[1]) * math.sin(f * math.pi / 2)
            row.append(((edge[0], y, -d), (edge[0], WINDSCREEN_TOP - d)))
        rows.append(row)
    b.grid(rows, lambda i, j: "seal" if i == 0 else "headliner")
    return b


def console(eye):
    """Radio/BOS console under the roof, its face plate tilted towards the driver; no lettering."""
    b = Builder("console", 0)
    tilt = math.radians(40)
    axes = ((1.0, 0.0, 0.0), (0.0, math.cos(tilt), math.sin(tilt)), (0.0, -math.sin(tilt), math.cos(tilt)))
    centre = (0.25, 0.43, -0.7)
    b.block(centre, axes, (0.2, 0.06, 0.16), "console")
    face = tuple(centre[k] - 0.0605 * axes[1][k] for k in range(3))
    for x0, x1, key in ((-0.17, -0.02, "display"), (0.0, 0.17, "display")):
        corners = []
        for s, t in ((x0, -0.08), (x1, -0.08), (x1, 0.04), (x0, 0.04)):
            corners.append(tuple(face[k] + s * axes[0][k] + t * axes[2][k] for k in range(3)))
        b.quad(corners, key)
    for s in (-0.12, -0.06, 0.06, 0.12):
        knob = tuple(face[k] + s * axes[0][k] + 0.1 * axes[2][k] - 0.008 * axes[1][k] for k in range(3))
        b.block(knob, axes, (0.012, 0.01, 0.012), "trim")
    return b


def passenger_visor(eye):
    """The passenger visor, stowed flat against the lining."""
    b = Builder("visor-stowed", 0)
    d0, d1 = 0.98, 0.84
    corners = []
    for x, d in ((0.12, d0), (0.72, d0), (0.72, d1), (0.12, d1)):
        edge = eye.at(eye.ndc_x(x, WINDSCREEN_TOP), eye.header(eye.ndc_x(x, WINDSCREEN_TOP)), WINDSCREEN_TOP)
        f = (WINDSCREEN_TOP - d) / (WINDSCREEN_TOP - ROOF_NEAR)
        y = edge[1] + (ROOF - edge[1]) * math.sin(f * math.pi / 2) - 0.012
        corners.append((x, y, -d))
    b.quad(corners, "visor")
    return b


def driver_visor(eye, p):
    """The lowered driver visor on the visor quad, built along its corner rays, with a raised rim and hinge."""
    v = p["visor"]
    b = Builder("visor", 0)
    left, right, bottom = v["left"] - 0.02, v["right"] + 0.02, v["bottom"] - 0.02
    top = lambda x: eye.header(x) + 0.04
    near, far = 0.74, 0.82
    rows = []
    for t in (0.0, 0.25, 0.5, 0.75, 1.0):
        row = []
        for k in range(9):
            x = left + (right - left) * k / 8
            y = bottom + (top(x) - bottom) * t
            point = eye.at(x, y, near + (far - near) * t)
            row.append((point, (point[0], point[1])))
        rows.append(row)
    b.grid(rows, lambda i, j: "visor")
    inset = 0.018
    for (x0, y0), (x1, y1) in (
        ((v["left"], v["bottom"]), (v["right"], v["bottom"])),
        ((v["left"], top(v["left"]) - 0.04), (v["right"], top(v["right"]) - 0.04)),
    ):
        d = near if y0 == v["bottom"] else far
        a = eye.at(x0, y0, d)
        c = eye.at(x1, y1, d)
        mid = tuple((a[k] + c[k]) / 2 + (0, inset * (1 if y0 == v["bottom"] else -1), 0.004)[k] for k in range(3))
        along = np.subtract(c, a)
        length = float(np.linalg.norm(along))
        ax = tuple(float(q) for q in along / length)
        b.block(mid, (ax, (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), (length / 2 - inset, 0.003, 0.003), "visor")
    hinge_a = eye.at(v["left"] + 0.03, top(v["left"]) - 0.035, far + 0.01)
    hinge_c = eye.at(v["right"] - 0.03, top(v["right"]) - 0.035, far + 0.01)
    mid = tuple((hinge_a[k] + hinge_c[k]) / 2 for k in range(3))
    length = float(np.linalg.norm(np.subtract(hinge_c, hinge_a)))
    b.block(mid, ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), (length / 2, 0.006, 0.006), "trim")
    return b


def pillar(eye, p):
    """The right A-pillar trim on its quad: leaning back towards the driver at the top, bulging towards the eye."""
    q = p["pillar"]
    bleed = p["bleed"]
    b = Builder("pillar", 1)
    rows = []
    for i in range(25):
        a = -0.03 + 1.06 * i / 24
        row = []
        for j in range(9):
            s = -0.08 + 1.16 * j / 8
            local = (s - 0.5) - q["lean"] * a
            x = q["centre"] + q["width"] * local
            y = -bleed + 2 * bleed * a
            d = 1.0 - 0.25 * a - 0.035 * math.sin(math.pi * min(max(s, 0.0), 1.0))
            point = eye.at(x, y, d)
            row.append((point, (s * 0.12, a * 1.4)))
        rows.append(row)
    b.grid(rows, lambda i, j: "seal" if j == 0 else "trim")
    handle = []
    for a in (0.28, 0.56):
        local = (0.55 - 0.5) - q["lean"] * a
        handle.append(eye.at(q["centre"] + q["width"] * local, -bleed + 2 * bleed * a, 0.88 - 0.25 * a))
    mid = tuple((handle[0][k] + handle[1][k]) / 2 for k in range(3))
    along = np.subtract(handle[1], handle[0])
    length = float(np.linalg.norm(along))
    ax = tuple(float(v) for v in along / length)
    side = np.cross(ax, (0.0, 0.0, 1.0))
    side = tuple(float(v) for v in side / np.linalg.norm(side))
    up = tuple(float(v) for v in np.cross(side, ax))
    b.block(mid, (ax, side, up), (length / 2, 0.014, 0.014), "trim")
    return b


# --- materials and passes -----------------------------------------------------------------------


def texture_stats(params, sources_dir, source_id):
    """Mean linear colour and mean roughness of a source, for the gains that put each part at its hue."""
    get = lambda kind: KIT["source_map"](params["sources"], params["maps"], sources_dir, source_id, kind)
    colour = srgb_decode(get("colour").astype(np.float64))
    return colour.reshape(-1, 3).mean(axis=0), float(get("roughness").mean())


def load_source(params, sources_dir, source_id, kind, colorspace):
    files = params["sources"][source_id]["files"]
    token = params["maps"][source_id][kind]
    rel = [r for r in sorted(files) if r.endswith("_%s.jpg" % token)][0]
    path = KIT["source_path"](sources_dir, rel)
    KIT["load_image"](sources_dir, rel, files[rel])  # hash check
    image = bpy.data.images.load(path, check_existing=False)
    image.colorspace_settings.name = colorspace
    return image


def pass_material(name, mp, images, stats, pass_name, samples):
    mat = bpy.data.materials.new("%s-%s" % (name, pass_name))
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emission = nt.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    nt.links.new(emission.outputs[0], out.inputs["Surface"])
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"

    def image(kind):
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = images[kind]
        tex.interpolation = "Cubic"
        nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
        return tex

    def scaled(socket, factor):
        node = nt.nodes.new("ShaderNodeMix")
        node.data_type = "RGBA"
        node.blend_type = "MULTIPLY"
        node.inputs["Factor"].default_value = 1.0
        nt.links.new(socket, node.inputs["A"])
        node.inputs["B"].default_value = tuple(factor) + (1.0,)
        return node.outputs["Result"]

    mean_colour, mean_rough = stats
    if pass_name == "albedo":
        target = np.array(srgb(mp["hue"])[:3])
        flatten = nt.nodes.new("ShaderNodeMix")
        flatten.data_type = "RGBA"
        flatten.inputs["Factor"].default_value = mp["contrast"]
        flatten.inputs["A"].default_value = tuple(float(c) for c in mean_colour) + (1.0,)
        nt.links.new(image("colour").outputs["Color"], flatten.inputs["B"])
        result = scaled(flatten.outputs["Result"], target / np.maximum(mean_colour, 1e-6))
        if name == "grille":
            checker = nt.nodes.new("ShaderNodeTexChecker")
            checker.inputs["Scale"].default_value = 160.0
            checker.inputs["Color1"].default_value = (1.0, 1.0, 1.0, 1.0)
            checker.inputs["Color2"].default_value = (0.35, 0.35, 0.35, 1.0)
            nt.links.new(uv.outputs["UV"], checker.inputs["Vector"])
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            nt.links.new(result, mix.inputs["A"])
            nt.links.new(checker.outputs["Color"], mix.inputs["B"])
            result = mix.outputs["Result"]
        nt.links.new(result, emission.inputs["Color"])
    elif pass_name == "normal":
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.space = "TANGENT"
        nmap.uv_map = "UVMap"
        nmap.inputs["Strength"].default_value = mp["normal"]
        nt.links.new(image("normal").outputs["Color"], nmap.inputs["Color"])
        encode = nt.nodes.new("ShaderNodeVectorMath")
        encode.operation = "MULTIPLY_ADD"
        encode.inputs[1].default_value = (0.5, 0.5, 0.5)
        encode.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(nmap.outputs["Normal"], encode.inputs[0])
        nt.links.new(encode.outputs["Vector"], emission.inputs["Color"])
    elif pass_name == "roughness":
        gain = mp["roughness"] / max(mean_rough, 1e-6)
        result = scaled(image("roughness").outputs["Color"], (gain, gain, gain))
        nt.links.new(result, emission.inputs["Color"])
    elif pass_name == "occlusion":
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        ao.inputs["Distance"].default_value = samples["occlusionDistance"]
        nt.links.new(ao.outputs["AO"], emission.inputs["Color"])
    else:
        attr = nt.nodes.new("ShaderNodeAttribute")
        attr.attribute_type = "OBJECT"
        attr.attribute_name = "sun"
        nt.links.new(attr.outputs["Fac"], emission.inputs["Color"])
    return mat


def setup_render(scene, p):
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.device = "CPU"
    cy.use_adaptive_sampling = False
    cy.use_denoising = False
    cy.seed = 0
    cy.use_animated_seed = False
    cy.max_bounces = 0
    scene.render.film_transparent = True
    scene.render.use_stamp = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    settings = scene.render.image_settings
    settings.file_format = "OPEN_EXR"
    settings.color_depth = "32"
    settings.exr_codec = "ZIP"
    cam = bpy.data.cameras.new("eye")
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = 2 * math.atan(p["overscan"] * math.tan(math.radians(p["fov"] / 2)))
    cam.clip_start = 0.05
    cam.clip_end = 10.0
    obj = bpy.data.objects.new("eye", cam)
    scene.collection.objects.link(obj)
    scene.camera = obj
    height = round(2 * p["overscan"] * PX)
    scene.render.resolution_y = height
    scene.render.resolution_x = round(height * p["aspect"])
    scene.render.resolution_percentage = 100


class Frame:
    """Where a render sits in bake NDC: full frame, or a border crop at a scale."""

    def __init__(self, scene, p, scale=1, ndc=None):
        self.overscan = p["overscan"]
        self.full_w = scene.render.resolution_x * scale
        self.full_h = scene.render.resolution_y * scale
        if ndc is None:
            self.px = (0, self.full_w, 0, self.full_h)
        else:
            (x0, x1), (y0, y1) = ndc
            to_px = lambda v, n: int(math.floor((v / self.overscan + 1) / 2 * n))
            self.px = (to_px(x0, self.full_w), to_px(x1, self.full_w) + 1, to_px(y0, self.full_h), to_px(y1, self.full_h) + 1)
        self.scale = scale

    def apply(self, scene):
        r = scene.render
        r.resolution_percentage = 100 * self.scale
        x0, x1, y0, y1 = self.px
        full = (x0, x1, y0, y1) == (0, self.full_w, 0, self.full_h)
        r.use_border = not full
        r.use_crop_to_border = not full
        if not full:
            r.border_min_x, r.border_max_x = x0 / self.full_w, x1 / self.full_w
            r.border_min_y, r.border_max_y = y0 / self.full_h, y1 / self.full_h

    def sample(self, image, x, y):
        """Bilinear lookup of a bottom-up (h, w, c) render at bake NDC (x, y)."""
        h, w = image.shape[:2]
        if (w, h) != (self.px[1] - self.px[0], self.px[3] - self.px[2]):
            raise RuntimeError("render is %dx%d, expected the border %r" % (w, h, self.px))
        fx = (x / self.overscan + 1) / 2 * self.full_w - 0.5 - self.px[0]
        fy = (y / self.overscan + 1) / 2 * self.full_h - 0.5 - self.px[2]
        if fx.min() < 0 or fy.min() < 0 or fx.max() > w - 1 or fy.max() > h - 1:
            raise RuntimeError("an atlas region samples outside its render")
        x0 = np.clip(np.floor(fx).astype(int), 0, w - 2)
        y0 = np.clip(np.floor(fy).astype(int), 0, h - 2)
        tx, ty = (fx - x0)[..., None], (fy - y0)[..., None]
        top = image[y0, x0] * (1 - tx) + image[y0, x0 + 1] * tx
        bottom = image[y0 + 1, x0] * (1 - tx) + image[y0 + 1, x0 + 1] * tx
        return top * (1 - ty) + bottom * ty


def render(scene, out_dir, name, frame):
    frame.apply(scene)
    path = os.path.join(out_dir, name + ".exr")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path, check_existing=False)
    try:
        w, h = image.size
        buf = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(buf)
    finally:
        bpy.data.images.remove(image)
    return buf.reshape(h, w, 4).astype(np.float64)


def region_coords(p, eye, region, kind):
    """Bake NDC (x, y) of every texel centre of an atlas region, top-down."""
    _, _, w, h = region["rect"]
    (x0, x1), (y0, y1) = region["x"], region["y"]
    gx, gy = np.meshgrid(x0 + (x1 - x0) * (np.arange(w) + 0.5) / w, y0 + (y1 - y0) * (np.arange(h) + 0.5) / h)
    if region["kind"] == "edge":
        xn = gx / p["aspect"]
        anchor = eye.dash if region["anchor"] == "dash" else eye.header
        return xn, anchor(xn) - gy if region["anchor"] == "dash" else anchor(xn) + gy
    if kind == "visor":
        v = p["visor"]
        xn = v["left"] + (v["right"] - v["left"]) * gx
        top = eye.header(v["left"]) + (eye.header(v["right"]) - eye.header(v["left"])) * gx
        return xn, v["bottom"] + gy * (top - v["bottom"])
    q = p["pillar"]
    local = (gy - 0.5) - q["lean"] * gx
    return q["centre"] + q["width"] * local, -p["bleed"] + 2 * p["bleed"] * gx


def bake_set(scene, out_dir, p, eye, name, objects, frame, materials_by_pass, slot_keys):
    """Render every pass of one object set and return straight (unpremultiplied) passes plus coverage."""
    for obj in scene.objects:
        if obj.type == "MESH":
            obj.hide_render = obj.name not in objects
    passes = {}
    for pass_name in PASSES:
        for obj in scene.objects:
            if obj.type == "MESH":
                for i, key in enumerate(slot_keys[obj.name]):
                    obj.data.materials[i] = materials_by_pass[pass_name][key]
        scene.cycles.samples = p["samples"]["occlusion" if pass_name == "occlusion" else "colour"]
        passes[pass_name] = render(scene, out_dir, "%s-%s" % (name, pass_name), frame)
    return passes


def straight(rgba_premultiplied, alpha, fill):
    a = alpha[..., None]
    out = np.where(a > 1e-4, rgba_premultiplied[..., :3] / np.maximum(a, 1e-4), np.array(fill))
    return out


def fill_region(atlas, mask, p, eye, region, kind, frame, passes, fills):
    x, y, w, h = region["rect"]
    xn, yn = region_coords(p, eye, region, kind)
    sampled = {k: frame.sample(v, xn, yn) for k, v in passes.items()}
    coverage = np.clip(sampled["albedo"][..., 3], 0.0, 1.0)
    albedo = straight(sampled["albedo"], coverage, fills["albedo"])
    normal = straight(sampled["normal"], coverage, (0.5, 0.5, 1.0))
    rough = straight(sampled["roughness"], coverage, (1.0, 1.0, 1.0))[..., 0]
    ao = straight(sampled["occlusion"], coverage, (1.0, 1.0, 1.0))[..., 0]
    sun = straight(sampled["sun"], coverage, (0.0, 0.0, 0.0))[..., 0]
    atlas["a"][y : y + h, x : x + w, :3] = srgb_encode(albedo)
    atlas["b"][y : y + h, x : x + w] = np.stack([normal[..., 0], normal[..., 1], rough, ao], axis=-1)
    mask[y : y + h, x : x + w, 0] = sun * coverage
    mask[y : y + h, x : x + w, 1] = coverage


def ndc_bounds(p, eye, region, kind, margin=0.01):
    xn, yn = region_coords(p, eye, region, kind)
    return (float(xn.min()) - margin, float(xn.max()) + margin), (float(yn.min()) - margin, float(yn.max()) + margin)


def main():
    params = KIT["load_params"](globals())
    if params.get("schema") != 1:
        raise ValueError("unknown cockpit params schema " + repr(params.get("schema")))
    hashes = KIT["provenance"](__file__, KIT_FILE, params)
    KIT["check_expected"](hashes, globals().get("EXPECTED_SHA256"))
    sources_dir = SOURCES_DIR
    out_dir = os.path.abspath(OUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    scene = KIT["reset_scene"]("cockpit-interior")
    eye = Eye(params)

    materials = params["materials"]
    images, stats = {}, {}
    for source_id in sorted({m["source"] for m in materials.values()}):
        stats[source_id] = texture_stats(params, sources_dir, source_id)
        images[source_id] = {
            "colour": load_source(params, sources_dir, source_id, "colour", "sRGB"),
            "normal": load_source(params, sources_dir, source_id, "normal", "Non-Color"),
            "roughness": load_source(params, sources_dir, source_id, "roughness", "Non-Color"),
        }
    by_pass = {
        pass_name: {
            name: pass_material(name, mp, images[mp["source"]], stats[mp["source"]], pass_name, params["samples"])
            for name, mp in sorted(materials.items())
        }
        for pass_name in PASSES
    }
    tiles = {name: mp["tile"] for name, mp in materials.items()}

    builders = [
        dash(eye, params),
        hood(eye),
        dash_details(eye),
        wipers(eye),
        header(eye),
        console(eye),
        passenger_visor(eye),
        driver_visor(eye, params),
        pillar(eye, params),
    ]
    slot_keys = {}
    for b in builders:
        b.build(by_pass["albedo"], tiles)
        slot_keys[b.name] = sorted(set(b.keys))
    setup_render(scene, params)

    atlas_def = params["atlas"]
    size = atlas_def["size"]
    atlas = {"a": np.zeros((size, size, 4)), "b": np.zeros((size, size, 4))}
    atlas["a"][..., 3] = 1.0
    atlas["b"][...] = (0.5, 0.5, 1.0, 1.0)
    mask = np.zeros((size, size, 4))
    mask[..., 3] = 1.0
    fills = {"albedo": tuple(srgb(materials["dash"]["hue"])[:3])}
    regions = atlas_def["regions"]

    main_objects = {b.name for b in builders} - {"visor", "pillar"}
    main_frame = Frame(scene, params)
    passes = bake_set(scene, out_dir, params, eye, "main", main_objects, main_frame, by_pass, slot_keys)
    for key in ("dashLeft", "dashRight", "headerLeft", "headerRight"):
        fill_region(atlas, mask, params, eye, regions[key], "edge", main_frame, passes, fills)
    for key, objects in (("visor", {"visor"}), ("pillar", {"pillar"})):
        frame = Frame(scene, params, DETAIL_SCALE, ndc_bounds(params, eye, regions[key], key))
        passes = bake_set(scene, out_dir, params, eye, key, objects, frame, by_pass, slot_keys)
        fill_region(atlas, mask, params, eye, regions[key], key, frame, passes, fills)

    half = box(mask, size // atlas_def["maskSize"])
    textures = [
        KIT["write_raw"](out_dir, "cockpit-atlas-a", atlas["a"], hashes),
        KIT["write_raw"](out_dir, "cockpit-atlas-b", atlas["b"], hashes),
        KIT["write_raw"](out_dir, "cockpit-atlas-m", half, hashes),
    ]
    result = {"out": out_dir, "blender": bpy.app.version_string, "textures": textures, **hashes}
    if not globals().get("KEEP_SCENE"):
        KIT["hand_back"]()
    return result


RESULT = main()
