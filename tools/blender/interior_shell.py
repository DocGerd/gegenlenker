"""THW truck cab interior for the Gegenlenker cockpit view (issue #159).

Run inside Blender with runpy.run_path(<this file>, init_globals={...}):
  PARAMS_PATH  path of tools/blender/params/<id>.interior.json
  PARAMS_JSON  the same JSON as text; wins over PARAMS_PATH (for hosts that cannot read the path)
  OUT_PATH     where the raw .glb is written
  EXPECTED_SHA256  optional {"scriptSha256": ..., "commonSha256": ..., "paramsSha256": ...}; the run aborts on a mismatch

The geometry is derived in src/render/interior-dims.ts and only exported here: every mesh in the
params is a list of solids (vertices, faces, hue key) whose faces wind counter-clockwise seen from
the front. Four vertex-coloured meshes in the sim body frame (blender_common.py):
"interior" (dashboard with binnacle, door tops, header), "wheel", and the unit slabs
"pillar-left" and "pillar-right", which the renderer scales into their slots.

Tested Blender version: 5.3.0 (bpy.app.version_string is printed and recorded in the manifest).
"""

import os
import runpy

HERE = os.path.dirname(__file__)
COMMON_FILE = os.path.join(HERE, "blender_common.py")
COMMON = runpy.run_path(COMMON_FILE)
Shape = COMMON["Shape"]
srgb = COMMON["srgb_to_linear"]

MESHES = ("interior", "wheel", "pillar-left", "pillar-right")


def build(solids, hues):
    shape = Shape()
    for solid in solids:
        shape.add(solid["verts"], solid["faces"], hues[solid["hue"]])
    return shape


def main():
    params = COMMON["load_params"](globals())
    if sorted(params["meshes"]) != sorted(MESHES):
        raise ValueError("expected the meshes " + ", ".join(MESHES))
    hashes = COMMON["provenance"](__file__, {"commonSha256": COMMON_FILE}, params)
    COMMON["check_expected"](hashes, globals().get("EXPECTED_SHA256"))
    hues = {key: srgb(value) for key, value in sorted(params["hues"].items())}
    objects = []
    for name in MESHES:
        solids = params["meshes"][name]
        if not solids:
            raise ValueError("mesh " + name + " has no solids")
        objects.append((name, build(solids, hues)))
    return COMMON["export"](OUT_PATH, "cockpit-interior", hashes, objects)


RESULT = main()
