"""Helpers shared by the Gegenlenker kit scripts (yard_kit.py; issue #160).

Loaded with runpy.run_path, never imported. Reuses shell_common.py read-only (hashing, params,
colours, prism frames). It keeps its own scene names because shell_common.reset_scene accepts only
the shell scenes, and it hands the session back under a shell scene name so the shell scripts still run.

Images are kept top-down (row 0 is the image's top), as KTX2 and glTF expect; Blender's pixel
buffers are bottom-up and are flipped on the way in. Deterministic: fixed names and order, numpy
box filters, an integer LCG instead of `random`, no clock.
"""

import hashlib
import json
import math
import os
import runpy

import bpy
import numpy as np

COMMON_FILE = os.path.join(os.path.dirname(__file__), "shell_common.py")
SHELL = runpy.run_path(COMMON_FILE)
srgb_to_linear = SHELL["srgb_to_linear"]
file_sha256 = SHELL["file_sha256"]
check_expected = SHELL["check_expected"]
load_params = SHELL["load_params"]
signed_area = SHELL["signed_area"]
FRAMES = SHELL["FRAMES"]
DECIMALS = SHELL["DECIMALS"]

KIT_SCENES = ("yard-kit",)
# shell_common.reset_scene refuses a dirty session that holds any scene but its own.
HANDBACK_SCENE = SHELL["KNOWN_SCENES"][0]

GLTF_OPTIONS = dict(
    SHELL["GLTF_OPTIONS"],
    export_texcoords=True,
    export_image_format="AUTO",
)


def provenance(entry_file, kit_file, params):
    hashes = SHELL["provenance"](entry_file, COMMON_FILE, params)
    hashes["kitCommonSha256"] = file_sha256(kit_file)
    return dict(sorted(hashes.items()))


# --- session -------------------------------------------------------------------------------------


def _purge():
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
        bpy.data.worlds,
    ):
        for block in list(blocks):
            blocks.remove(block)


def reset_scene(name):
    """One empty scene called `name`; preferences and add-ons stay untouched (no read_factory_settings)."""
    if name not in KIT_SCENES:
        raise ValueError("unknown scene name " + name)
    if bpy.data.filepath:
        raise RuntimeError("refusing to reset a saved session: " + bpy.data.filepath)
    known = KIT_SCENES + SHELL["KNOWN_SCENES"]
    if bpy.data.is_dirty and any(s.name not in known for s in bpy.data.scenes):
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
    _purge()
    return keep


def hand_back():
    """Leave one empty scene the shell scripts accept."""
    scene = bpy.context.scene
    if scene.name not in KIT_SCENES:
        raise RuntimeError("hand_back outside a kit scene: " + scene.name)
    _purge()
    scene.name = HANDBACK_SCENE


# --- images --------------------------------------------------------------------------------------


def source_path(sources_dir, rel):
    return os.path.join(sources_dir, *rel.split("/"))


def load_image(sources_dir, rel, sha256):
    """A source JPG as a top-down float array (h, w, 4) of its stored values; aborts on a hash mismatch."""
    path = source_path(sources_dir, rel)
    with open(path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != sha256:
        raise RuntimeError("%s is %s, expected %s" % (rel, digest, sha256))
    image = bpy.data.images.load(path, check_existing=False)
    try:
        image.colorspace_settings.name = "Non-Color"
        w, h = image.size
        buf = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(buf)
    finally:
        bpy.data.images.remove(image)
    return np.ascontiguousarray(buf.reshape(h, w, 4)[::-1])


def source_map(sources, maps, sources_dir, source_id, kind):
    """One map of a source: `colour`/`normal` -> (h, w, 3), `roughness`/`ao` -> (h, w); None if absent."""
    token = maps[source_id][kind]
    if token is None:
        return None
    name, _, channel = token.partition(":")
    files = sources[source_id]["files"]
    matches = [rel for rel in sorted(files) if rel.endswith("_%s_2k.jpg" % name) or rel.endswith("_%s.jpg" % name)]
    if len(matches) != 1:
        raise RuntimeError("%s: %d files for map %s" % (source_id, len(matches), token))
    pixels = load_image(sources_dir, matches[0], files[matches[0]])
    if kind in ("colour", "normal"):
        return pixels[:, :, :3]
    return pixels[:, :, "rgb".index(channel or "r")]


def box(a, factor):
    """Box-filter downsample by an integer factor."""
    if factor == 1:
        return a
    h, w = a.shape[:2]
    if h % factor or w % factor:
        raise ValueError("box filter factor %d does not divide %dx%d" % (factor, w, h))
    shape = (h // factor, factor, w // factor, factor) + a.shape[2:]
    return a.reshape(shape).mean(axis=(1, 3))


def srgb_decode(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def srgb_encode(a):
    a = np.clip(a, 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def tint_linear(lin, hue, weights=None):
    """Scale each channel so the (weighted) mean takes the sRGB `hue`; keeps the detail."""
    target = np.array(srgb_to_linear(hue)[:3], dtype=np.float64)
    if weights is None:
        mean = lin.reshape(-1, 3).mean(axis=0)
    else:
        w = weights.reshape(-1, 1)
        mean = (lin.reshape(-1, 3) * w).sum(axis=0) / max(float(w.sum()), 1e-9)
    return np.clip(lin * (target / np.maximum(mean, 1e-6)), 0.0, 1.0)


def to_bytes(a):
    return np.clip(np.floor(a * 255.0 + 0.5), 0, 255).astype(np.uint8)


def write_raw(out_dir, name, rgba, hashes):
    """Top-down RGBA8 pixels as `<name>.rgba` plus `<name>.json` with the run's input hashes; returns the record."""
    data = to_bytes(rgba)
    h, w = data.shape[:2]
    raw = np.ascontiguousarray(data).tobytes()
    record = dict(hashes, name=name, width=w, height=h, pixelsSha256=hashlib.sha256(raw).hexdigest())
    record["blender"] = bpy.app.version_string
    with open(os.path.join(out_dir, name + ".rgba"), "wb") as f:
        f.write(raw)
    with open(os.path.join(out_dir, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(record, f, sort_keys=True)
    return record


class Lcg:
    """Deterministic pseudo-random numbers (glibc constants), independent of Python's `random`."""

    def __init__(self, seed):
        self.state = seed & 0x7FFFFFFF

    def next(self):
        self.state = (1103515245 * self.state + 12345) & 0x7FFFFFFF
        return self.state / 0x80000000

    def uniform(self, lo, hi):
        return lo + (hi - lo) * self.next()

    def index(self, n):
        return min(int(self.next() * n), n - 1)


# --- meshes --------------------------------------------------------------------------------------


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a):
    length = math.sqrt(_dot(a, a))
    if length < 1e-12:
        raise ValueError("zero-length vector")
    return (a[0] / length, a[1] / length, a[2] / length)


def face_normal(points):
    """Newell's method: robust for any planar polygon, oriented by its winding (counter-clockwise = front)."""
    n = [0.0, 0.0, 0.0]
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        n[0] += (p[1] - q[1]) * (p[2] + q[2])
        n[1] += (p[2] - q[2]) * (p[0] + q[0])
        n[2] += (p[0] - q[0]) * (p[1] + q[1])
    return _norm(n)


def face_axes(normal):
    """In-plane (u, v): u horizontal and v up on walls; x and y on horizontal faces."""
    if abs(normal[2]) > 0.9:
        u = (1.0, 0.0, 0.0)
        return u, _norm(_cross(normal, u))
    u = _norm(_cross(normal, (0.0, 0.0, 1.0)))
    return u, _cross(u, normal)


class Part:
    """Polygons with a material slot, a linear vertex colour and atlas UVs per face.

    `look(key)` returns (slot, colour, uv) where uv is either ("point", (u, v)) for a flat swatch,
    or ("tile", (u0, v0, u1, v1), (span_u, span_v)) for a textured tile in Blender UV space.
    """

    def __init__(self, look):
        self.look = look
        self.verts = []
        self.faces = []
        self.slots = []
        self.colours = []
        self.uvs = []
        self.normals = []

    def face(self, points, key, uv01=None, normals=None):
        """A convex planar polygon, counter-clockwise seen from its front."""
        points = [tuple(round(c, DECIMALS) for c in p) for p in points]
        slot, colour, mapping = self.look(key)
        if mapping[0] == "point":
            uvs = [mapping[1]] * len(points)
        else:
            u0, v0, u1, v1 = mapping[1]
            if uv01 is None:
                n = face_normal(points)
                au, av = face_axes(n)
                pu = [_dot(p, au) for p in points]
                pv = [_dot(p, av) for p in points]
                su, sv = mapping[2]
                uv01 = [
                    (min((a - min(pu)) / su, 1.0), min((b - min(pv)) / sv, 1.0)) for a, b in zip(pu, pv)
                ]
            uvs = [(u0 + s * (u1 - u0), v0 + t * (v1 - v0)) for s, t in uv01]
        base = len(self.verts)
        self.verts.extend(points)
        self.faces.append(tuple(range(base, base + len(points))))
        self.slots.append(slot)
        self.colours.append(colour)
        self.uvs.append([(round(u, DECIMALS), round(v, DECIMALS)) for u, v in uvs])
        self.normals.append(normals)

    def prism(self, poly, w0, w1, key, frame="xy", keys=None):
        """Convex polygon (u, v) extruded from w0 to w1; `keys` may override "bottom", "top" or "sides"."""
        keys = keys or {}
        if signed_area(poly) < 0:
            poly = list(reversed(poly))
        place = FRAMES[frame]
        low = [place(u, v, w0) for u, v in poly]
        high = [place(u, v, w1) for u, v in poly]
        if keys.get("bottom", key) is not None:
            self.face(list(reversed(low)), keys.get("bottom", key))
        if keys.get("top", key) is not None:
            self.face(high, keys.get("top", key))
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            self.face([low[i], low[j], high[j], high[i]], keys.get("sides", key))

    def box(self, x, y, z, key, **keys):
        (x0, x1), (y0, y1), (z0, z1) = x, y, z
        if x1 - x0 < 1e-9 or y1 - y0 < 1e-9 or z1 - z0 < 1e-9:
            raise ValueError("degenerate box %r" % ((x, y, z),))
        self.prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, key, keys=keys)

    def tube(self, p0, p1, radius, key, segments=6, radius1=None, caps=True):
        """Polygonal section swept from p0 to p1, tapering to radius1."""
        axis = _norm(_sub(p1, p0))
        ref = (0.0, 0.0, 1.0) if abs(axis[2]) < 0.9 else (1.0, 0.0, 0.0)
        u = _norm(_cross(axis, ref))
        v = _cross(axis, u)
        r1 = radius if radius1 is None else radius1

        def ring(p, r):
            out = []
            for i in range(segments):
                a = 2 * math.pi * i / segments
                out.append(tuple(p[k] + r * (math.cos(a) * u[k] + math.sin(a) * v[k]) for k in range(3)))
            return out

        low, high = ring(p0, radius), ring(p1, r1)
        if caps:
            self.face(list(reversed(low)), key)
            self.face(high, key)
        for i in range(segments):
            j = (i + 1) % segments
            self.face([low[i], low[j], high[j], high[i]], key)

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def bounds(self):
        lo = [min(v[k] for v in self.verts) for k in range(3)]
        hi = [max(v[k] for v in self.verts) for k in range(3)]
        return [round(c, 3) for c in lo], [round(c, 3) for c in hi]


def placeholder_material(name, colour):
    """A material whose base colour reads a 2x1 non-solid image, so glb-optimise's prune keeps TEXCOORD_0."""
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    image = bpy.data.images.new(name + "-placeholder", 2, 1, alpha=False)
    image.pixels.foreach_set([1.0, 1.0, 1.0, 1.0] + list(colour[:3]) + [1.0])
    image.pack()
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Closest"
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def add_part(name, part, materials, extras=None):
    if not part.faces:
        raise ValueError(name + ": no faces")
    used = sorted(set(part.slots))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(part.verts, [], part.faces)
    mesh.update()
    if mesh.validate():
        raise RuntimeError(name + ": mesh.validate() repaired the geometry")
    if len(mesh.polygons) != len(part.faces):
        raise RuntimeError("%s: %d polygons, expected %d" % (name, len(mesh.polygons), len(part.faces)))
    for slot in used:
        mesh.materials.append(materials[slot])
    mesh.polygons.foreach_set("material_index", [used.index(s) for s in part.slots])
    uv = mesh.uv_layers.new(name="UVMap")
    flat_uv = []
    flat_colour = []
    for face_uvs, colour in zip(part.uvs, part.colours):
        for u, v in face_uvs:
            flat_uv.extend((u, v))
        flat_colour.extend(colour * len(face_uvs))
    uv.data.foreach_set("uv", flat_uv)
    attr = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    attr.data.foreach_set("color", flat_colour)
    mesh.color_attributes.active_color = attr
    if any(n is not None for n in part.normals):
        mesh.polygons.foreach_set("use_smooth", [True] * len(part.faces))
        loops = []
        for face, normals in zip(part.faces, part.normals):
            if normals is None:
                flat = face_normal([part.verts[i] for i in face])
                loops.extend([flat] * len(face))
            else:
                loops.extend(_norm(n) for n in normals)
        mesh.normals_split_custom_set(loops)
    obj = bpy.data.objects.new(name, mesh)
    lo, hi = part.bounds()
    obj["bounds"] = {"min": lo, "max": hi}
    obj["triangles"] = part.triangles()
    for key, value in sorted((extras or {}).items()):
        obj[key] = value
    bpy.context.scene.collection.objects.link(obj)
    return obj


def export_glb(out_path, hashes):
    for key, value in hashes.items():
        bpy.context.scene[key] = value
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    missing = sorted(k for k in GLTF_OPTIONS if k not in known)
    if missing:
        raise RuntimeError("this Blender lacks glTF export options: " + ", ".join(missing))
    if os.path.exists(out_path):
        os.remove(out_path)
    status = bpy.ops.export_scene.gltf(**dict(sorted(GLTF_OPTIONS.items()), filepath=out_path))
    if status != {"FINISHED"} or not os.path.isfile(out_path):
        raise RuntimeError("glTF export did not write " + out_path + ": " + repr(status))
    with open(out_path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()
