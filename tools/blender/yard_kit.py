"""Yard-kit pieces and their atlases for the Gegenlenker surroundings (issue #160).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/yard-kit.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH
  SOURCES_DIR  directory holding the CC0 source JPGs at the paths the params list (hash-checked)
  OUT_PATH     where the raw .glb is written; the raw atlases go beside it
  EXPECTED_SHA256  optional {"scriptSha256", "commonSha256", "kitCommonSha256"}; the run aborts on a mismatch

Writes yard-kit.raw.glb (one node per kit piece, see src/render/yard-kit-dims.ts for the frame) and,
as top-down RGBA8, yard-kit-atlas-a (sRGB albedo), yard-kit-atlas-b (normal x, normal y, roughness,
AO; linear) and yard-kit-leaves (sRGB colour, linear alpha). Materials "yard-atlas" and
"yard-leaves" carry a placeholder texture only; the runtime binds the KTX2 atlases. Vertex colours
hold each face's mean albedo (linear) for an untextured preset. Livery-free: no lettering or emblems.

Tested Blender version: 5.3.0.
"""

import math
import os
import runpy

import bpy
import numpy as np

KIT_FILE = os.path.join(os.path.dirname(__file__), "kit_common.py")
KIT = runpy.run_path(KIT_FILE)
Part = KIT["Part"]
Lcg = KIT["Lcg"]
box = KIT["box"]
srgb = KIT["srgb_to_linear"]
srgb_decode = KIT["srgb_decode"]
srgb_encode = KIT["srgb_encode"]
tint_linear = KIT["tint_linear"]
DECIMALS = KIT["DECIMALS"]

SOURCE_SIZE = 2048
SPRITE_SIZE = 256  # LeafSet009 is cut into sprites at this resolution: one leaf is about 45 texels


def rounded(values):
    return [round(float(v), DECIMALS) for v in values]


# --- atlases -------------------------------------------------------------------------------------


def named_map(params, sources_dir, source_id, name):
    files = params["sources"][source_id]["files"]
    matches = [rel for rel in sorted(files) if rel.endswith("_%s.jpg" % name)]
    if len(matches) != 1:
        raise RuntimeError("%s: %d files named %s" % (source_id, len(matches), name))
    return KIT["load_image"](sources_dir, matches[0], files[matches[0]])


def build_atlas(params, sources_dir):
    """Albedo (sRGB) and packed normal/roughness/AO (linear) atlases plus each tile's mean albedo."""
    atlas = params["atlas"]
    size = atlas["size"]
    albedo = np.full((size, size, 3), 0.5)
    packed = np.ones((size, size, 4))
    packed[:, :, 0:2] = 0.5
    means = {}
    cache = {}
    for key in sorted(atlas["tiles"]):
        tile = atlas["tiles"][key]
        x, y, w, h = tile["rect"]
        if w != h or SOURCE_SIZE % w:
            raise ValueError("tile %s must be square and divide the source size" % key)
        sid = tile["source"]
        if sid not in cache:
            get = lambda kind: KIT["source_map"](params["sources"], atlas["maps"], sources_dir, sid, kind)
            cache[sid] = {kind: get(kind) for kind in ("colour", "normal", "roughness", "ao")}
        maps = cache[sid]
        factor = SOURCE_SIZE // w
        lin = box(srgb_decode(maps["colour"].astype(np.float64)), factor)
        mean = lin.reshape(-1, 3).mean(axis=0)
        lin = np.clip(mean + (lin - mean) * tile["contrast"], 0.0, 1.0)
        if tile["tint"] is not None:
            lin = tint_linear(lin, params["hues"][tile["tint"]])
        albedo[y : y + h, x : x + w] = srgb_encode(lin)
        means[key] = rounded(lin.reshape(-1, 3).mean(axis=0)) + [1.0]
        packed[y : y + h, x : x + w, 0:2] = box(maps["normal"][:, :, 0:2], factor)
        packed[y : y + h, x : x + w, 2] = box(maps["roughness"], factor)
        if maps["ao"] is not None:
            packed[y : y + h, x : x + w, 3] = box(maps["ao"], factor)
    swatches = atlas["swatches"]
    ox, oy = swatches["origin"]
    cell = swatches["cell"]
    for i, key in enumerate(sorted(swatches["roughness"])):
        x = ox + cell * (i % swatches["columns"])
        y = oy + cell * (i // swatches["columns"])
        if x + cell > size or y + cell > size:
            raise ValueError("swatch %s falls outside the atlas" % key)
        lin = np.array(srgb(params["hues"][key])[:3])
        albedo[y : y + cell, x : x + cell] = srgb_encode(lin)
        packed[y : y + cell, x : x + cell] = (0.5, 0.5, swatches["roughness"][key], 1.0)
        means[key] = rounded(lin) + [1.0]
    alpha = np.ones((size, size, 1))
    return np.concatenate([albedo, alpha], axis=2), packed, means


def leaf_sprites(params, sources_dir):
    """The six LeafSet009 leaves as premultiplied linear RGBA crops."""
    factor = SOURCE_SIZE // SPRITE_SIZE
    colour = box(srgb_decode(named_map(params, sources_dir, "leafSet", "Color")[:, :, :3].astype(np.float64)), factor)
    alpha = box(named_map(params, sources_dir, "leafSet", "Opacity")[:, :, 0].astype(np.float64), factor)
    grid = params["leafAtlas"]["sprites"]
    sprites = []
    for row in range(grid["rows"]):
        for col in range(grid["columns"]):
            x0, x1 = col * SPRITE_SIZE // grid["columns"], (col + 1) * SPRITE_SIZE // grid["columns"]
            y0, y1 = row * SPRITE_SIZE // grid["rows"], (row + 1) * SPRITE_SIZE // grid["rows"]
            ys, xs = np.nonzero(alpha[y0:y1, x0:x1] > 0.5)
            if len(xs) == 0:
                raise RuntimeError("LeafSet009 cell %d,%d holds no leaf" % (col, row))
            ya, yb = max(y0 + ys.min() - 1, 0), min(y0 + ys.max() + 2, SPRITE_SIZE)
            xa, xb = max(x0 + xs.min() - 1, 0), min(x0 + xs.max() + 2, SPRITE_SIZE)
            a = alpha[ya:yb, xa:xb, None]
            sprites.append(np.concatenate([colour[ya:yb, xa:xb] * a, a], axis=2))
    return sprites


def sample(sprite, sx, sy):
    """Bilinear sample, transparent outside."""
    h, w = sprite.shape[:2]
    padded = np.zeros((h + 2, w + 2, 4))
    padded[1:-1, 1:-1] = sprite
    fx, fy = sx + 1.0, sy + 1.0
    x0 = np.clip(np.floor(fx).astype(int), 0, w)
    y0 = np.clip(np.floor(fy).astype(int), 0, h)
    tx = np.clip(fx - x0, 0.0, 1.0)[..., None]
    ty = np.clip(fy - y0, 0.0, 1.0)[..., None]
    inside = ((fx >= 0) & (fx <= w + 1) & (fy >= 0) & (fy <= h + 1))[..., None]
    top = padded[y0, x0] * (1 - tx) + padded[y0, x0 + 1] * tx
    bottom = padded[y0 + 1, x0] * (1 - tx) + padded[y0 + 1, x0 + 1] * tx
    return (top * (1 - ty) + bottom * ty) * inside


def composite(width, height, sprites, spec):
    """Scatter leaf sprites into a premultiplied canvas; earlier (deeper) leaves are darker."""
    canvas = np.zeros((height, width, 4))
    lcg = Lcg(spec["seed"])
    radius = 0.42 * min(width, height)
    count = spec["count"]
    for i in range(count):
        sprite = sprites[lcg.index(len(sprites))]
        sh, sw = sprite.shape[:2]
        scale = lcg.uniform(*spec["size"]) / max(sh, sw)
        if spec["shape"] == "disc":
            phi = lcg.uniform(0.0, 2 * math.pi)
            r = radius * lcg.next() ** 0.6
            cx, cy = width / 2 + r * math.cos(phi), height / 2 + r * math.sin(phi)
            theta = phi + math.pi / 2 + lcg.uniform(-0.6, 0.6)
        else:
            cx, cy = lcg.uniform(0.0, width), lcg.uniform(0.0, height)
            theta = lcg.uniform(0.0, 2 * math.pi)
        shade = 0.55 + 0.45 * i / count + lcg.uniform(-0.08, 0.08)
        reach = 0.5 * math.hypot(sw, sh) * scale + 1
        xa, xb = max(int(cx - reach), 0), min(int(cx + reach) + 1, width)
        ya, yb = max(int(cy - reach), 0), min(int(cy + reach) + 1, height)
        if xa >= xb or ya >= yb:
            continue
        gx, gy = np.meshgrid(np.arange(xa, xb) + 0.5 - cx, np.arange(ya, yb) + 0.5 - cy)
        c, s = math.cos(theta), math.sin(theta)
        sx = (c * gx + s * gy) / scale + sw / 2 - 0.5
        sy = (-s * gx + c * gy) / scale + sh / 2 - 0.5
        src = sample(sprite, sx, sy) * np.array([shade, shade, shade, 1.0])
        dst = canvas[ya:yb, xa:xb]
        canvas[ya:yb, xa:xb] = src + dst * (1 - src[..., 3:4])
    return canvas


def finish_card(premultiplied, hue):
    """Straight sRGB colour tinted to `hue` over the opaque texels; transparent texels take the hue, so mips do not fringe."""
    a = np.clip(premultiplied[..., 3], 0.0, 1.0)
    lin = premultiplied[..., :3] / np.maximum(a, 1e-4)[..., None]
    opaque = a > 0.5
    lin = tint_linear(lin, hue, opaque.astype(np.float64))
    lin[~opaque] = np.array(srgb(hue)[:3])
    return np.concatenate([srgb_encode(lin), a[..., None]], axis=2)


def build_leaf_atlas(params, sources_dir):
    leaf = params["leafAtlas"]
    size = leaf["size"]
    out = np.zeros((size, size, 4))
    sprites = leaf_sprites(params, sources_dir)
    for key in sorted(leaf["clusters"]):
        spec = leaf["clusters"][key]
        x, y, w, h = spec["rect"]
        out[y : y + h, x : x + w] = finish_card(composite(w, h, sprites, spec), params["hues"][key])
    x, y, w, h = leaf["tuft"]["rect"]
    factor = SOURCE_SIZE // w
    colour = box(srgb_decode(named_map(params, sources_dir, "foliage", "Color")[:, :, :3].astype(np.float64)), factor)
    alpha = box(named_map(params, sources_dir, "foliage", "Opacity")[:, :, 0].astype(np.float64), factor)
    out[y : y + h, x : x + w] = finish_card(np.concatenate([colour * alpha[..., None], alpha[..., None]], axis=2), params["hues"]["tuft"])
    return out


def palette(params, means):
    """key -> (material slot, linear colour, UV mapping) for Part."""
    atlas = params["atlas"]
    size = atlas["size"]
    gutter = atlas["gutter"]
    looks = {}
    for key, tile in atlas["tiles"].items():
        x, y, w, h = tile["rect"]
        uv = ((x + gutter) / size, 1 - (y + h - gutter) / size, (x + w - gutter) / size, 1 - (y + gutter) / size)
        looks[key] = ("atlas", means[key], ("tile", uv, tuple(tile["span"])))
    swatches = atlas["swatches"]
    ox, oy = swatches["origin"]
    cell = swatches["cell"]
    for i, key in enumerate(sorted(swatches["roughness"])):
        cx = ox + cell * (i % swatches["columns"] + 0.5)
        cy = oy + cell * (i // swatches["columns"] + 0.5)
        looks[key] = ("atlas", means[key], ("point", (cx / size, 1 - cy / size)))
    leaf = params["leafAtlas"]
    lsize = leaf["size"]
    lg = leaf["gutter"]
    for key, spec in list(leaf["clusters"].items()) + [("tuft", leaf["tuft"])]:
        x, y, w, h = spec["rect"]
        uv = ((x + lg) / lsize, 1 - (y + h - lg) / lsize, (x + w - lg) / lsize, 1 - (y + lg) / lsize)
        looks["leaf:" + key] = ("leaves", srgb(params["hues"][key]), ("tile", uv, (1.0, 1.0)))
    return lambda key: looks[key]


# --- pieces --------------------------------------------------------------------------------------


def front(part, x, z, y, key):
    """A quad in the plane y facing +Y."""
    (x0, x1), (z0, z1) = x, z
    part.face([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], key)


def card(part, centre, a, b, key, normal_origin):
    """A leaf card spanning centre +- a +- b, its normals pointing away from normal_origin."""
    corners = [
        tuple(centre[k] + sa * a[k] + sb * b[k] for k in range(3)) for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1))
    ]
    normals = [tuple(p[k] - normal_origin[k] for k in range(3)) for p in corners]
    part.face(corners, key, uv01=[(0, 0), (1, 0), (1, 1), (0, 1)], normals=normals)


def hall_top(part, h):
    b, e = h["bay"], h["eaves"]
    part.box((-b / 2, b / 2), (-h["wall"], h["fasciaRelief"]), (e - h["fascia"], e), "frame")
    y0 = h["fasciaRelief"]
    part.box((-b / 2, b / 2), (y0, y0 + h["gutter"]), (e - h["gutter"], e - 0.02), "zinc")


def hall_door_bay(part, h):
    b, e, w = h["bay"], h["eaves"], h["wall"]
    d = h["door"]
    dw, dh, fr, rc = d["width"] / 2, d["height"], d["frame"], d["recess"]
    left, right = (-b / 2, -dw - fr), (dw + fr, b / 2)
    for jamb in (left, right):
        part.box(jamb, (-w, h["plinthRelief"]), (0, h["plinth"]), "concrete", bottom=None)
        part.box(jamb, (-w, 0), (h["plinth"], e - h["fascia"]), "cladding", bottom=None)
    part.box((-dw - fr, dw + fr), (-w, 0), (dh + fr, e - h["fascia"]), "cladding")
    part.box((-dw - fr, -dw), (0, 0.04), (0, dh + fr), "frame", bottom=None)
    part.box((dw, dw + fr), (0, 0.04), (0, dh + fr), "frame", bottom=None)
    part.box((-dw, dw), (0, 0.04), (dh, dh + fr), "frame")
    front(part, (-dw - fr, dw + fr), (0, dh + fr), -rc, "door")
    for k in range(1, d["sections"]):
        z = dh * k / d["sections"]
        part.box((-dw, dw), (-rc, -rc + 0.012), (z - 0.012, z + 0.012), "doorJoint")
    hall_top(part, h)


def hall_wall_bay(part, h):
    b, e, w = h["bay"], h["eaves"], h["wall"]
    part.box((-b / 2, b / 2), (-w, h["plinthRelief"]), (0, h["plinth"]), "concrete", bottom=None)
    part.box((-b / 2, b / 2), (-w, 0), (h["plinth"], e - h["fascia"]), "cladding", bottom=None)
    hall_top(part, h)


def hall_corner(part, h):
    e, r = h["eaves"], h["downpipe"]
    part.box((-0.1, 0.1), (-0.1, 0.1), (0, e), "frame", bottom=None)
    x, y = 0.3, 0.12
    part.tube((x, y, 0.2), (x, y, e - h["fascia"]), r, "zinc", caps=False)
    part.tube((x, y, 0.2), (x, y + 0.18, 0.06), r, "zinc")
    part.tube((x, y, e - h["fascia"]), (x, h["fasciaRelief"] + h["gutter"] / 2, e - h["gutter"]), r, "zinc", caps=False)


def hall_roof(part, h):
    """One metre deep; the placement scales it along Y to the hall's depth."""
    b, e = h["bay"], h["eaves"]
    part.box((-b / 2, b / 2), (-1, 0), (e - h["roofThickness"], e + 0.05), "frame", top="roof", bottom=None)


def office_window(part, win, zs):
    wx, zt = win["width"] / 2, zs + win["height"]
    f, rc = win["frame"], win["recess"]
    front(part, (-wx, wx), (zs, zt), -rc, "glass")
    part.box((-wx, -wx + f), (-rc, -rc + 0.06), (zs, zt), "frame")
    part.box((wx - f, wx), (-rc, -rc + 0.06), (zs, zt), "frame")
    part.box((-wx + f, wx - f), (-rc, -rc + 0.06), (zs, zs + f), "frame")
    part.box((-wx + f, wx - f), (-rc, -rc + 0.06), (zt - f, zt), "frame")
    part.box((-f / 2, f / 2), (-rc, -rc + 0.06), (zs + f, zt - f), "frame")
    part.box((-wx - 0.03, wx + 0.03), (-rc, 0.05), (zs - 0.03, zs), "zinc")


def office_shell(part, o, first_storey):
    """Piers, storeys from `first_storey` up, attica and coping of one bay."""
    b, w, st = o["bay"], o["wall"], o["storey"]
    win = o["window"]
    wx = win["width"] / 2
    top = o["storeys"] * st
    for pier in ((-b / 2, -wx), (wx, b / 2)):
        part.box(pier, (-w, 0), (o["plinth"] if first_storey == 0 else 0, top), "plaster", bottom=None, top=None)
    for k in range(first_storey, o["storeys"]):
        z0 = k * st
        zs = z0 + win["sill"]
        part.box((-wx, wx), (-w, 0), (max(z0, o["plinth"]), zs), "plaster", bottom=None)
        part.box((-wx, wx), (-w, 0), (zs + win["height"], z0 + st), "plaster", top=None)
        office_window(part, win, zs)
    part.box((-b / 2, b / 2), (-w, 0), (top, top + o["attica"]), "plaster", bottom=None)
    part.box((-b / 2, b / 2), (-w - 0.03, 0.04), (top + o["attica"], top + o["attica"] + o["coping"]), "zinc")


def office_bay(part, o):
    part.box((-o["bay"] / 2, o["bay"] / 2), (-o["wall"], 0.03), (0, o["plinth"]), "concrete", bottom=None)
    office_shell(part, o, 0)


def office_entrance(part, o):
    b, w, st = o["bay"], o["wall"], o["storey"]
    en = o["entrance"]
    eh, gx = en["height"], b / 2 - 0.1
    office_shell(part, o, 1)
    for pier in ((-b / 2, -gx), (gx, b / 2)):
        part.box(pier, (-w, 0), (0, st), "plaster", bottom=None)
    part.box((-gx, gx), (-w, 0), (eh, st), "plaster", top=None)
    front(part, (-gx, gx), (0, eh), -0.1, "glazing")
    for i in range(en["mullions"]):
        x = -gx + 2 * gx * i / (en["mullions"] - 1)
        part.box((max(x - 0.04, -gx), min(x + 0.04, gx)), (-0.1, -0.04), (0, eh), "frame", bottom=None)
    part.box((-gx, gx), (-0.1, -0.04), (eh - 0.08, eh), "frame")
    part.box((-gx, gx), (-0.1, -0.04), (2.1, 2.16), "frame")
    z = eh + 0.15
    part.box((-b / 2 - 0.2, b / 2 + 0.2), (0, en["canopyDepth"]), (z, z + en["canopyThickness"]), "frame", top="roof")


def office_roof(part, o):
    """One metre deep; the placement scales it along Y to the building's depth."""
    top = o["storeys"] * o["storey"]
    part.box((-o["bay"] / 2, o["bay"] / 2), (-1, 0), (top - o["roofThickness"], top + 0.1), "plaster", top="roof", bottom=None)


def wash_canopy(part, c):
    length, depth, clear, col, beam = c["length"], c["depth"], c["clearance"], c["column"], c["beam"]
    xs = (-length / 2 + col / 2, length / 2 - col / 2)
    ys = (-col / 2, -depth + col / 2)
    for x in xs:
        for y in ys:
            part.box((x - col / 2, x + col / 2), (y - col / 2, y + col / 2), (0, clear), "galvanised", bottom=None)
    for y in ys:
        part.box((-length / 2, length / 2), (y - col / 2, y + col / 2), (clear, clear + beam), "galvanised")
    for x in xs:
        part.box((x - col / 2, x + col / 2), (-depth + col, -col), (clear, clear + beam), "galvanised")
    z = clear + beam
    part.box((-length / 2 - 0.2, length / 2 + 0.2), (-depth - 0.2, 0.2), (z, z + c["roof"]), "door", sides="frame")


def flagpole(part, f):
    half = f["footing"] / 2
    part.box((-half, half), (-half, half), (0, 0.1), "concrete", bottom=None)
    part.tube((0, 0, 0.1), (0, 0, f["height"]), f["radius"], "galvanised", segments=8, radius1=f["radius"] * 0.6)
    part.box((-0.05, 0.05), (-0.05, 0.05), (f["height"], f["height"] + 0.08), "galvanised")


def fence_rails(part, f, x0, x1, z0, z1):
    for r in range(f["rails"]):
        z = z0 + 0.15 + (z1 - z0 - 0.3) * r / (f["rails"] - 1)
        for y in ((0.01, 0.022), (-0.022, -0.01)):
            part.box((x0, x1), y, (z - 0.004, z + 0.004), "frame")


def fence_panel(part, f):
    """The post stands at the origin; the panel runs along +X to the next panel's post."""
    p, length, height = f["post"] / 2, f["panel"], f["height"]
    part.box((-p, p), (-p, p), (0, height + 0.05), "frame", bottom=None)
    fence_rails(part, f, p, length - p, 0, height)
    half = f["barWidth"] / 2
    for i in range(int(length / f["barPitch"] + 1e-9)):
        x = f["barPitch"] * (i + 0.5)
        part.box((x - half, x + half), (-0.006, 0.006), (0.03, height), "frame", bottom=None)


def fence_gate(part, f):
    """Both posts and one swing leaf; the hinge post stands at the origin."""
    gp, width, height = f["gatePost"] / 2, f["gate"], f["height"]
    for x in (0, width):
        part.box((x - gp, x + gp), (-gp, gp), (0, height + 0.1), "frame", bottom=None)
    x0, x1 = gp + 0.03, width - gp - 0.03
    for z in ((0.05, 0.1), (height - 0.05, height)):
        part.box((x0, x1), (-0.025, 0.025), z, "frame")
    for x in ((x0, x0 + 0.05), (x1 - 0.05, x1)):
        part.box(x, (-0.025, 0.025), (0.05, height), "frame")
    half = f["barWidth"] / 2
    for i in range(1, int((x1 - x0) / f["barPitch"])):
        x = x0 + f["barPitch"] * i
        part.box((x - half, x + half), (-0.006, 0.006), (0.1, height - 0.05), "frame")


def hedge(part, hd):
    length, depth, height = hd["length"], hd["depth"], hd["height"]
    part.box((-length / 2, length / 2), (-depth / 2 + 0.12, depth / 2 - 0.12), (0, height - 0.15), "hedgeCore", bottom=None)
    a = (length / 2, 0, 0)
    b = (0, 0, height / 2)
    for y in (depth / 2 - 0.05, -depth / 2 + 0.05):
        card(part, (0, y, height / 2), a if y > 0 else (-length / 2, 0, 0), b, "leaf:hedge", (0, 0, height * 0.4))
    for i in range(hd["cards"]):
        x = -length / 2 + length * (i + 0.5) / hd["cards"]
        for sign in (1, -1):
            s = depth * 0.5
            card(part, (x, 0, height / 2 + 0.05), (s, sign * s, 0), (0, 0, height / 2), "leaf:hedge", (x, 0, height * 0.4))
    card(part, (0, 0, height - 0.05), a, (0, depth / 2, 0), "leaf:hedge", (0, 0, height * 0.2))


def tree(part, t, cards):
    lcg = Lcg(t["seed"])
    height, base, radius, trunk = t["height"], t["crownBase"], t["crownRadius"], t["trunk"]
    rz = (height - base) / 2
    zc = base + rz
    top = base + 0.6 * (height - base)
    part.tube((0, 0, 0), (0, 0, top), trunk, "bark", radius1=trunk * 0.4, caps=False)
    for k in range(5):
        phi = 2 * math.pi * k / 5 + lcg.uniform(-0.4, 0.4)
        z0 = base + (top - base) * lcg.uniform(0.0, 0.7)
        end = (0.6 * radius * math.cos(phi), 0.6 * radius * math.sin(phi), z0 + 0.5 * rz)
        part.tube((0, 0, z0), end, trunk * 0.3, "bark", segments=4, radius1=trunk * 0.12, caps=False)
    key = "leaf:" + t["species"]
    origin = (0, 0, zc - 0.3 * rz)
    for _ in range(cards):
        z = lcg.uniform(-0.6, 1.0)
        phi = lcg.uniform(0.0, 2 * math.pi)
        ring = math.sqrt(max(1 - z * z, 0.0))
        r = lcg.uniform(0.55, 0.95)
        centre = (r * radius * ring * math.cos(phi), r * radius * ring * math.sin(phi), zc + r * rz * z)
        size = lcg.uniform(1.0, 1.4) * radius / 3.6
        psi = lcg.uniform(0.0, math.pi)
        tilt = lcg.uniform(-0.4, 0.4)
        for turn in (0.0, math.pi / 2):
            a = (size * math.cos(psi + turn), size * math.sin(psi + turn), 0.0)
            ax = (math.cos(psi + turn), math.sin(psi + turn), 0.0)
            b = (-math.sin(tilt) * ax[1] * size, math.sin(tilt) * ax[0] * size, math.cos(tilt) * size)
            card(part, centre, a, b, key, origin)


def tuft(part, tf):
    half, height = tf["width"] / 2, tf["height"] / 2
    for k in range(3):
        psi = math.pi * k / 3
        card(part, (0, 0, height), (half * math.cos(psi), half * math.sin(psi), 0), (0, 0, height), "leaf:tuft", (0, 0, -0.3))


def bin_1100(part, p):
    hl, hd, h = p["length"] / 2, p["depth"] / 2, p["height"]
    part.box((-hl, hl), (-hd, hd), (0.18, h - 0.12), "container", top="bin")
    part.box((-hl - 0.02, hl + 0.02), (-hd - 0.02, hd + 0.02), (h - 0.12, h), "bin")
    for x in (-hl + 0.1, hl - 0.1):
        for y in (-hd + 0.1, hd - 0.1):
            part.box((x - 0.05, x + 0.05), (y - 0.05, y + 0.05), (0, 0.18), "bin", bottom=None)


def bin_240(part, p):
    hl, hd, h = p["length"] / 2, p["depth"] / 2, p["height"]
    part.box((-hl, hl), (-hd, hd), (0.05, h - 0.07), "bin")
    part.box((-hl - 0.02, hl + 0.02), (-hd - 0.04, hd + 0.02), (h - 0.07, h), "bin")
    for x in (-hl + 0.05, hl - 0.05):
        part.tube((x - 0.03, -hd, 0.1), (x + 0.03, -hd, 0.1), 0.1, "frame", segments=8)


def hydrant(part, p):
    r, h = p["radius"], p["height"]
    part.tube((0, 0, 0), (0, 0, 0.08), r * 1.45, "hydrant", segments=8)
    part.tube((0, 0, 0.08), (0, 0, h - 0.15), r, "hydrant", segments=8, caps=False)
    part.tube((0, 0, h - 0.15), (0, 0, h - 0.09), r * 1.2, "hydrant", segments=8)
    part.tube((0, 0, h - 0.09), (0, 0, h), r * 0.7, "hydrant", segments=8)
    for side in (1, -1):
        part.tube((side * r * 0.8, 0, h * 0.55), (side * (r + 0.12), 0, h * 0.55), 0.045, "hydrant", segments=8)


def bench(part, p):
    hl, seat, depth, back = p["length"] / 2, p["seat"], p["depth"] / 2, p["back"]
    for x in (-hl + 0.15, hl - 0.15):
        part.box((x - 0.03, x + 0.03), (-depth + 0.05, depth - 0.05), (seat - 0.06, seat - 0.02), "frame")
        for y in (-depth + 0.08, depth - 0.08):
            part.box((x - 0.03, x + 0.03), (y - 0.03, y + 0.03), (0, seat - 0.06), "frame", bottom=None)
        part.box((x - 0.03, x + 0.03), (-depth + 0.02, -depth + 0.06), (seat - 0.06, back), "frame")
    for i in range(3):
        y = -depth + 0.1 + (2 * depth - 0.2) * i / 2
        part.box((-hl, hl), (y - 0.06, y + 0.06), (seat - 0.02, seat + 0.02), "wood")
    for z in (back - 0.22, back - 0.08):
        part.box((-hl, hl), (-depth + 0.06, -depth + 0.1), (z - 0.05, z + 0.05), "wood")


def bike_rack(part, p):
    hw, h, r = p["width"] / 2, p["height"], p["tube"]
    for i in range(p["hoops"]):
        x = (i - (p["hoops"] - 1) / 2) * p["pitch"]
        for y in (-hw, hw):
            part.tube((x, y, 0), (x, y, h - 0.1), r, "galvanised", caps=False)
        part.tube((x, -hw, h - 0.1), (x, -hw + 0.1, h), r, "galvanised", caps=False)
        part.tube((x, hw, h - 0.1), (x, hw - 0.1, h), r, "galvanised", caps=False)
        part.tube((x, -hw + 0.1, h), (x, hw - 0.1, h), r, "galvanised")


def disc(radius, segments=16):
    return [(radius * math.cos(2 * math.pi * i / segments), radius * math.sin(2 * math.pi * i / segments)) for i in range(segments)]


def sign_post(part, p):
    """A plain 'no vehicles' roundel (white disc, red ring): no lettering."""
    h, r = p["height"], p["sign"] / 2
    part.tube((0, 0, 0), (0, 0, h), 0.03, "galvanised", caps=False)
    zc = h - r - 0.05
    # the "zx" frame takes (z, x) pairs and extrudes along y
    part.prism([(zc + v, u) for v, u in disc(r)], 0.035, 0.055, "galvanised", frame="zx", keys={"top": "signWhite"})
    for i in range(16):
        a0, a1 = 2 * math.pi * i / 16, 2 * math.pi * (i + 1) / 16
        ring = [(r * 0.8, a0), (r, a0), (r, a1), (r * 0.8, a1)]
        points = [(rr * math.sin(a), 0.057, zc + rr * math.cos(a)) for rr, a in ring]
        part.face(points, "signRed")


def salt_bin(part, p):
    hl, hd, h = p["length"] / 2, p["depth"] / 2, p["height"]
    part.box((-hl, hl), (-hd, hd), (0.05, h - 0.15), "saltBin")
    # the "yz" frame takes (y, z) pairs and extrudes along x
    lid = [(-hd - 0.02, h - 0.15), (hd + 0.02, h - 0.15), (hd + 0.02, h - 0.08), (-hd - 0.02, h)]
    part.prism(lid, -hl - 0.02, hl + 0.02, "saltBin", frame="yz")
    for x in (-hl + 0.05, hl - 0.05):
        part.box((x - 0.04, x + 0.04), (-hd, hd), (0, 0.05), "frame", bottom=None)


def pieces(params):
    d = params["dims"]
    p = d["props"]
    out = [
        ("hall-door-bay", lambda part: hall_door_bay(part, d["hall"])),
        ("hall-wall-bay", lambda part: hall_wall_bay(part, d["hall"])),
        ("hall-corner", lambda part: hall_corner(part, d["hall"])),
        ("hall-roof", lambda part: hall_roof(part, d["hall"])),
        ("office-bay", lambda part: office_bay(part, d["office"])),
        ("office-entrance", lambda part: office_entrance(part, d["office"])),
        ("office-roof", lambda part: office_roof(part, d["office"])),
        ("wash-canopy", lambda part: wash_canopy(part, d["canopy"])),
        ("flagpole", lambda part: flagpole(part, d["flagpole"])),
        ("fence-panel", lambda part: fence_panel(part, d["fence"])),
        ("fence-gate", lambda part: fence_gate(part, d["fence"])),
        ("hedge", lambda part: hedge(part, d["hedge"])),
        ("grass-tuft", lambda part: tuft(part, d["tuft"])),
    ]
    for t in d["trees"]:
        out.append((t["id"], lambda part, t=t: tree(part, t, d["treeCards"])))
    out += [
        ("bin-1100", lambda part: bin_1100(part, p["bin1100"])),
        ("bin-240", lambda part: bin_240(part, p["bin240"])),
        ("hydrant", lambda part: hydrant(part, p["hydrant"])),
        ("bench", lambda part: bench(part, p["bench"])),
        ("bike-rack", lambda part: bike_rack(part, p["bikeRack"])),
        ("sign-post", lambda part: sign_post(part, p["signPost"])),
        ("salt-bin", lambda part: salt_bin(part, p["saltBin"])),
    ]
    return out


def main():
    params = KIT["load_params"](globals())
    if params.get("schema") != 1:
        raise ValueError("unknown yard-kit params schema " + repr(params.get("schema")))
    hashes = KIT["provenance"](__file__, KIT_FILE, params)
    KIT["check_expected"](hashes, globals().get("EXPECTED_SHA256"))
    sources_dir = SOURCES_DIR
    out_dir = os.path.dirname(os.path.abspath(OUT_PATH))
    os.makedirs(out_dir, exist_ok=True)

    KIT["reset_scene"]("yard-kit")
    albedo, packed, means = build_atlas(params, sources_dir)
    leaves = build_leaf_atlas(params, sources_dir)
    look = palette(params, means)
    materials = {
        "atlas": KIT["placeholder_material"]("yard-atlas", (0.5, 0.5, 0.5)),
        "leaves": KIT["placeholder_material"]("yard-leaves", (0.2, 0.35, 0.1)),
    }
    triangles = {}
    for name, build in pieces(params):
        part = Part(look)
        build(part)
        KIT["add_part"](name, part, materials)
        triangles[name] = part.triangles()
    glb_sha = KIT["export_glb"](OUT_PATH, hashes)
    textures = [
        KIT["write_raw"](out_dir, "yard-kit-atlas-a", albedo, hashes),
        KIT["write_raw"](out_dir, "yard-kit-atlas-b", packed, hashes),
        KIT["write_raw"](out_dir, "yard-kit-leaves", leaves, hashes),
    ]
    result = {
        "out": OUT_PATH,
        "blender": bpy.app.version_string,
        "rawGlbSha256": glb_sha,
        "textures": textures,
        "triangles": triangles,
        **hashes,
    }
    return result


RESULT = main()
