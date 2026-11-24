"""Gegenlenker README hero banner: builds the scene in the open Blender and renders a PNG.

Run inside Blender (MCP `execute_blender_code` or `blender -P`), once per look; encode the PNGs to
docs/brand/banner-{light,dark}.webp afterwards. Inputs come from the committed glbs. Never calls
read_factory_settings (it would disable the MCP add-on).
Globals set before exec: ASSETS (required, dir of src/render/assets, Blender-readable path),
OUT (required, png path), W, H, ENGINE, SAMPLES, DARK (night look).
"""
import math
import os

import bpy
from mathutils import Vector

for _name in ("ASSETS", "OUT"):
    if _name not in globals():
        raise RuntimeError(f"banner.py: set {_name} before running")
ASSETS = globals()["ASSETS"]
OUT = globals()["OUT"]
W = globals().get("W", 2560)
H = globals().get("H", 800)
ENGINE = globals().get("ENGINE", "BLENDER_EEVEE")
SAMPLES = globals().get("SAMPLES", 64)
DARK = globals().get("DARK", False)

# --- brand colours (docs/brand/BRAND.md) -------------------------------------------------------


def lin(h, a=1.0):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return (*c, a)


TOKENS_DAY = dict(
    sky="#b4e6ff", haze="#dcebf2", yard="#c2c7cd", verge="#7f858d", band="#202428",
    pavement="#f4f5f7", street="#5e646b", marking="#f6f6f6", accent="#0f7c72",
    accent_lit="#01afa1", cone="#cc0605", wheel="#14161a", rim="#a5a5a5", chassis="#101214",
    concrete="#8c8c86",
)
# night: the day surface tokens under moonlight (the night tokens are pre-darkened twins for the lit
# top-down view and would double-darken a lit perspective render); only the dome takes night hues
TOKENS_NIGHT = dict(TOKENS_DAY, sky="#03050a", haze="#18243f")
T = TOKENS_NIGHT if DARK else TOKENS_DAY

# --- clean scene (no read_factory_settings) ----------------------------------------------------
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images):
    for b in list(coll):
        if b.users == 0:
            coll.remove(b)
scene = bpy.context.scene
col = scene.collection


def mat(name, color, rough=0.7, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = lin(emit)
        b.inputs["Emission Strength"].default_value = 1.0
    return m


def link(o, parent=None):
    col.objects.link(o)
    if parent:
        o.parent = parent
    return o


def box(name, size, loc, material, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    for c in list(o.users_collection):
        c.objects.unlink(o)
    o.name = name
    o.scale = size
    o.data.materials.append(material)
    return link(o, parent)


def cyl(name, radius, depth, loc, material, parent=None, axis_y=True, verts=48):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=verts, location=loc,
                                        rotation=(math.pi / 2, 0, 0) if axis_y else (0, 0, 0))
    o = bpy.context.active_object
    for c in list(o.users_collection):
        c.objects.unlink(o)
    o.name = name
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = True
    return link(o, parent)


def empty(name, loc=(0, 0, 0), rot_z=0.0, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.5
    e.location = loc
    e.rotation_euler = (0, 0, rot_z)
    return link(e, parent)


def import_glb(fname, parent):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, fname))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        # glb nodes are already in the vehicle frame (rear axle / turntable origin): parent with identity
        if o.parent is None:
            o.parent = parent
        for c in list(o.users_collection):
            if c is not col:
                c.objects.unlink(o)
        if o.name not in col.objects:
            col.objects.link(o)
    return new


# --- vehicle assembly: sim frame, x forward, z up; truck rear axle at origin -------------------
TRUCK_COUPLING = -1.25  # man-le-18-280 couplingOffset
DRAWBAR = 2.2  # krone-azw-18 drawbar (eye ahead of turntable, dolly frame)
TRAILER_WB = 5.17  # krone-azw-18 wheelbase (rear axle to turntable)
# heading angles (rad, CCW+): truck, drawbar, trailer. Chain of slight, growing articulation.
TH0, TH1, TH2 = math.radians(10), math.radians(25), math.radians(40)


def dirv(a):
    return Vector((math.cos(a), math.sin(a), 0))


truck_o = Vector((0, 0, 0))
eye = truck_o + Vector((TRUCK_COUPLING, 0, 0)) if TH0 == 0 else truck_o + Vector(
    (TRUCK_COUPLING * math.cos(TH0), TRUCK_COUPLING * math.sin(TH0), 0))
turntable = eye - DRAWBAR * dirv(TH1)
trailer_o = turntable - TRAILER_WB * dirv(TH2)

truck = empty("rig_truck", truck_o, TH0)
dolly = empty("rig_dolly", turntable, TH1)
trailer = empty("rig_trailer", trailer_o, TH2)

m_tyre = mat("tyre", T["chassis"], 0.85)
m_rim = mat("rim", T["rim"], 0.4, 0.8)
m_chassis = mat("chassis", T["chassis"], 0.6, 0.3)

import_glb("man-le-18-280-cab.glb", truck)
import_glb("man-le-18-280-body.glb", truck)
import_glb("krone-azw-18-trailer.glb", trailer)
# the trailer glb carries the dolly node: re-parent it to the turntable frame
for o in bpy.data.objects:
    if o.name.split(".")[0] == "dolly" and o.type == "MESH":
        o.parent = dolly
        # glb mesh nodes sit in the dolly frame (turntable origin) already

R = 0.5


def wheel_set(parent, x, track, width, twin=False):
    for side in (-1, 1):
        offsets = (0,) if not twin else (-0.18, 0.18)
        for k, d in enumerate(offsets):
            y = side * (track / 2 - width / 2) - side * 0.0 + d * side * 0.0
            if twin:
                y = side * (track / 2 - width / 2 + (0.0 if k == 0 else -width - 0.02))
            cyl("wheel", R, width, (x, y, R), m_tyre, parent)
            cyl("rim", R * 0.55, width + 0.01, (x, y, R), m_rim, parent, verts=24)
    cyl("axle", 0.07, track, (x, 0, R), m_chassis, parent, verts=16)


wheel_set(truck, 0.0, 1.8, 0.32, twin=True)  # rear track 1.80
wheel_set(truck, 3.9, 1.95, 0.32)  # front track 1.95, wheelbase 3.9
wheel_set(trailer, 0.0, 2.04, 0.30)  # rear axle, track 2.04
wheel_set(dolly, 0.0, 2.04, 0.30)  # front axle under the turntable
m_swap = mat("swap", "#00387b", 0.6)
m_swapw = mat("swapw", "#f6f6f6", 0.6)
box("swapbody", (7.45, 2.5, 2.35), (2.1, 0, 1.28 + 2.35 / 2 + 0.05), m_swap, trailer)
box("swapstripe", (7.47, 2.52, 0.28), (2.1, 0, 1.28 + 1.3), m_swapw, trailer)
# chassis rails under truck body and cab
for s in (-0.42, 0.42):
    box("rail", (5.6, 0.14, 0.2), (1.4, s, 0.72), m_chassis, truck)

# --- yard ground and brand-token surroundings --------------------------------------------------
m_yard = mat("yard", T["yard"], 0.92)
m_verge = mat("verge", T["verge"], 0.95)
m_band = mat("kerb", T["band"], 0.8)
m_mark = mat("marking", T["marking"], 0.7)
m_cone = mat("cone", T["cone"], 0.55)
m_acc = mat("accent", T["accent_lit"] if DARK else T["accent"], 0.6, emit=T["accent_lit"] if DARK else None)
m_case = mat("casing", T["wheel"], 0.7)
m_conc = mat("concrete", T["concrete"], 0.9)

box("yard", (400, 400, 0.2), (0, 0, -0.1), m_yard)
box("verge", (400, 60, 0.3), (0, 52, -0.05), m_verge)
box("kerb", (400, 0.35, 0.22), (0, 21.8, 0.0), m_band)
# concrete wall segments with kerb: soft backdrop for the vehicles
for i, x in enumerate(range(-40, 41, 5)):
    box(f"wall{i}", (4.9, 0.35, 1.6), (x, 23.5, 0.8), m_conc)

# expansion joints: a faint slab grid, darker than the yard
m_joint = mat("joint", "#b5bac1", 0.95)
for k in range(-12, 9):
    box(f"jx{k}", (0.07, 80, 0.012), (k * 5, 0, 0.005), m_joint)
for k in range(-6, 4):
    box(f"jy{k}", (160, 0.07, 0.012), (0, k * 5, 0.005), m_joint)

# target bay: accent outline on a dark casing, white bay lines either side
BAY_L, BAY_W, BAY_IN = 10.5, 4.0, 3.5  # bay length/width; how far the trailer rear is inside it
BAY_A = TH2 - math.radians(4)  # bay axis, slightly flatter than the trailer: it is steering in
rear = trailer_o - 1.675 * dirv(TH2)
BAY_C = rear - dirv(BAY_A) * (BAY_L / 2 - BAY_IN) + Vector((-math.sin(BAY_A), math.cos(BAY_A), 0)) * 0.35


def strip(name, a, b, width, z, material):
    """flat ribbon from point a to b."""
    d = (b - a)
    L = d.length
    mid = (a + b) / 2
    o = box(name, (L, width, 0.015), (mid.x, mid.y, z), material)
    o.rotation_euler = (0, 0, math.atan2(d.y, d.x))
    return o


def rect_outline(name, c, ang, w, l, thick, z, material):
    u = dirv(ang); v = Vector((-u.y, u.x, 0))
    pts = [c + u * l / 2 + v * w / 2, c + u * l / 2 - v * w / 2, c - u * l / 2 - v * w / 2, c - u * l / 2 + v * w / 2]
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        d = (b - a).normalized()
        strip(f"{name}{i}", a - d * thick / 2, b + d * thick / 2, thick, z, material)


rect_outline("bay_case", BAY_C, BAY_A, BAY_W, BAY_L, 0.5, 0.012, m_case)
rect_outline("bay", BAY_C, BAY_A, BAY_W, BAY_L, 0.3, 0.024, m_acc)

# guidance corridor: dashed accent line on dark casing, arcing from the trailer rear to the bay
p0 = rear - dirv(TH2) * 0.4
p3 = BAY_C - dirv(BAY_A) * (BAY_L / 2 - 0.9)
c1 = p0 - dirv(TH2) * 2.5
c2 = p3 + dirv(BAY_A) * 2.5


def bez(t):
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t * t * c2 + t ** 3 * p3


N = 17
for i in range(N):
    if i % 2:
        continue
    a, b = bez(i / N), bez((i + 1) / N)
    strip(f"dash_case{i}", a, b, 0.38, 0.012, m_case)
    strip(f"dash{i}", a, b, 0.2, 0.026, m_acc)

# traffic cones (yard obstacle kind), two near the bay entrance, one far
def cone(loc):
    bpy.ops.mesh.primitive_cone_add(radius1=0.18, radius2=0.04, depth=0.7, location=(loc[0], loc[1], 0.35), vertices=32)
    o = bpy.context.active_object
    for c in list(o.users_collection):
        c.objects.unlink(o)
    o.data.materials.append(m_cone)
    for p in o.data.polygons:
        p.use_smooth = True
    link(o)
    box("cone_base", (0.45, 0.45, 0.04), (loc[0], loc[1], 0.02), m_band)
    # white band
    bpy.ops.mesh.primitive_cone_add(radius1=0.118, radius2=0.085, depth=0.16, location=(loc[0], loc[1], 0.4), vertices=32)
    b = bpy.context.active_object
    for c in list(b.users_collection):
        c.objects.unlink(b)
    b.data.materials.append(m_mark)
    link(b)


end = BAY_C + dirv(BAY_A) * BAY_L / 2
v = Vector((-math.sin(BAY_A), math.cos(BAY_A), 0))
for s in (-1, 1):
    cone(end + dirv(BAY_A) * 1.2 + v * s * 3.0)
cone(BAY_C - dirv(BAY_A) * (BAY_L / 2 + 1.5) + v * 1.2)
cone(Vector((4.0, 9.0, 0)))

# --- world, light, camera ----------------------------------------------------------------------
w = bpy.data.worlds.new("sky")
scene.world = w
w.use_nodes = True
nt = w.node_tree
nt.nodes.clear()
tc = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
mr = nt.nodes.new("ShaderNodeMapRange")
ramp = nt.nodes.new("ShaderNodeValToRGB")
bg = nt.nodes.new("ShaderNodeBackground")
outn = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(tc.outputs["Generated"], sep.inputs[0])
nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
mr.inputs["From Min"].default_value = 0.5
mr.inputs["From Max"].default_value = 1.0
nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
ramp.color_ramp.elements[0].color = lin(T["haze"])
ramp.color_ramp.elements[1].color = lin(T["sky"])
ramp.color_ramp.elements[1].position = 0.9
nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.5 if DARK else 0.45
nt.links.new(bg.outputs["Background"], outn.inputs["Surface"])

sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 2.0 if DARK else 3.2
sun.angle = math.radians(7)
sun.color = (0.62, 0.72, 1.0) if DARK else (1.0, 0.96, 0.9)
so = bpy.data.objects.new("sun", sun)
so.rotation_euler = (math.radians(48), math.radians(6), math.radians(-35))
link(so)

CAM_AZ = math.radians(globals().get("CAM_AZ", 88))  # view heading; the vehicle axis runs ~30 deg: rear three-quarter
CAM_EL = math.radians(globals().get("CAM_EL", 38))
CAM_D = globals().get("CAM_D", 31)
closed_end = BAY_C - dirv(BAY_A) * BAY_L / 2
mid = (closed_end + Vector((5.0, 1.0, 0))) / 2 + Vector((0, 0, 1.0)) + Vector(globals().get("CAM_SHIFT", (0.8, 0.7, 0)))
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 35
cam_d.sensor_width = 36
cam_d.clip_end = 600
co = bpy.data.objects.new("cam", cam_d)
link(co)
co.location = mid - CAM_D * (math.cos(CAM_EL) * dirv(CAM_AZ) - Vector((0, 0, math.sin(CAM_EL))))
tgt = empty("cam_target", mid)
trk = co.constraints.new("TRACK_TO")
trk.target = tgt
trk.track_axis = "TRACK_NEGATIVE_Z"
trk.up_axis = "UP_Y"
scene.camera = co

# --- render ------------------------------------------------------------------------------------
scene.render.engine = ENGINE
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.compression = 90
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
if ENGINE == "CYCLES":
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
else:
    try:
        scene.eevee.taa_render_samples = SAMPLES
        scene.eevee.use_shadows = True
        scene.eevee.use_raytracing = True
    except Exception:
        pass
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
result = {"out": OUT, "engine": ENGINE, "trailer_o": list(trailer_o), "turntable": list(turntable)}
