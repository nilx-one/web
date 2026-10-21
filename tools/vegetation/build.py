# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
"""Build the map's low-poly trees and bushes as GLBs.

Run with Blender's Python module (`pip install bpy==5.2.2`):

    python -I tools/vegetation/build.py <output dir>

Every model is generated here, from a fixed seed, so the same script gives the
same bytes. Each one is metre-scale, Y-up, stands on y = 0 at the origin and is
a single static mesh: trees and bushes are drawn by the thousand, instanced, so
they carry no rig and no clip.
"""

import math
import random
import sys
from pathlib import Path

import bpy  # noqa: I001 - Blender's module must load before bmesh exists
import bmesh
from mathutils import Vector

# Soft, pale greens and a warm grey bark, after the city's own palette: the
# map is light, so the vegetation is too, and reads as mass, not as detail.
COLOURS = {
    "leaf-light": "#b9dca8",
    "leaf": "#9fcd8f",
    "leaf-deep": "#86b97a",
    "needle": "#7fae86",
    "bark": "#a99a88",
}


def linear(hex_colour):
    def channel(value):
        c = value / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (*[channel(int(hex_colour[i:i + 2], 16)) for i in (1, 3, 5)], 1.0)


def material(name):
    found = bpy.data.materials.get(name)
    if found is not None:
        return found
    made = bpy.data.materials.new(name)
    made.use_nodes = True
    bsdf = next(n for n in made.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = linear(COLOURS[name])
    bsdf.inputs["Roughness"].default_value = 0.95
    bsdf.inputs["Metallic"].default_value = 0.0
    return made


def blob(bm, centre, radii, rng, material_index, subdivisions=2, jitter=0.1):
    """A lumpy icosphere: the canopy reads as leaves, not as a ball."""
    made = bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
    verts = made["verts"]
    for v in verts:
        n = v.co.normalized()
        scale = 1.0 + rng.uniform(-jitter, jitter)
        v.co = Vector((n.x * radii[0], n.y * radii[1], n.z * radii[2])) * scale + Vector(centre)
    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        f.material_index = material_index
    return faces


def cone(bm, base_z, height, radius, sides, material_index, rng, jitter=0.06):
    made = bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=radius,
                                 radius2=0.0, depth=height)
    for v in made["verts"]:
        v.co.z += base_z + height / 2
        if v.co.z < base_z + height * 0.99:
            v.co.x *= 1 + rng.uniform(-jitter, jitter)
            v.co.y *= 1 + rng.uniform(-jitter, jitter)
    for f in {f for v in made["verts"] for f in v.link_faces}:
        f.material_index = material_index


def trunk(bm, height, base_radius, top_radius, material_index, sides=6, lean=(0, 0)):
    made = bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=base_radius,
                                 radius2=top_radius, depth=height)
    for v in made["verts"]:
        v.co.z += height / 2
        t = v.co.z / height
        v.co.x += lean[0] * t
        v.co.y += lean[1] * t
    for f in {f for v in made["verts"] for f in v.link_faces}:
        f.material_index = material_index


def build(name, shape, seed, out):
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    rng = random.Random(seed)
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new()
    materials = shape(bm, rng)
    for m in materials:
        mesh.materials.append(material(m))
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False
    path = out / f"{name}.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_yup=True,
                              export_animations=False, export_cameras=False,
                              export_lights=False, export_extras=False)
    lo = [min(v.co[i] for v in mesh.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in mesh.vertices) for i in range(3)]
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    print(f"built {path.name}: tris={tris} size={tuple(round(hi[i] - lo[i], 2) for i in range(3))} "
          f"min_z={round(lo[2], 3)} bytes={path.stat().st_size}")


# Each shape returns the materials its face indices refer to, in order.

def tree_round(bm, rng):
    # A linden or a chestnut: the city's commonest street and park tree.
    trunk(bm, 3.6, 0.22, 0.14, 0, lean=(rng.uniform(-.1, .1), rng.uniform(-.1, .1)))
    blob(bm, (0, 0, 5.4), (2.5, 2.4, 2.2), rng, 1)
    blob(bm, (1.2, 0.5, 6.4), (1.6, 1.5, 1.5), rng, 2)
    blob(bm, (-1.0, -0.6, 6.6), (1.5, 1.6, 1.4), rng, 1)
    blob(bm, (0.1, -1.1, 4.7), (1.4, 1.3, 1.1), rng, 3)
    return ["bark", "leaf", "leaf-light", "leaf-deep"]


def tree_tall(bm, rng):
    # A poplar or a birch: narrow and tall, the line along an avenue.
    trunk(bm, 4.2, 0.18, 0.11, 0)
    blob(bm, (0, 0, 7.6), (1.5, 1.5, 4.4), rng, 1, jitter=0.1)
    blob(bm, (0.3, 0.2, 10.4), (1.0, 1.0, 1.8), rng, 2, jitter=0.1)
    return ["bark", "leaf", "leaf-light"]


def tree_pine(bm, rng):
    # A spruce or a pine, as in the city's parks and its woods.
    trunk(bm, 2.4, 0.2, 0.12, 0)
    cone(bm, 1.6, 4.2, 2.4, 7, 1, rng)
    cone(bm, 3.8, 3.6, 1.9, 7, 1, rng)
    cone(bm, 5.8, 3.2, 1.3, 7, 1, rng)
    return ["bark", "needle"]


def bush(bm, rng):
    blob(bm, (0, 0, 0.55), (0.8, 0.75, 0.6), rng, 0)
    blob(bm, (0.55, 0.25, 0.45), (0.55, 0.5, 0.45), rng, 1)
    blob(bm, (-0.45, -0.3, 0.42), (0.5, 0.55, 0.42), rng, 2)
    return ["leaf", "leaf-light", "leaf-deep"]


def hedge(bm, rng):
    # A clipped row, two metres long: the edge of a courtyard or a square.
    for i, x in enumerate((-0.75, -0.25, 0.25, 0.75)):
        blob(bm, (x, 0, 0.5), (0.42, 0.42, 0.5), rng, i % 2, jitter=0.08)
    return ["leaf-deep", "leaf"]


MODELS = [
    ("tree-round", tree_round, 11),
    ("tree-tall", tree_tall, 12),
    ("tree-pine", tree_pine, 13),
    ("bush", bush, 21),
    ("hedge", hedge, 22),
]


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = Path(args[0])
    out.mkdir(parents=True, exist_ok=True)
    for name, shape, seed in MODELS:
        for m in list(bpy.data.materials):
            bpy.data.materials.remove(m)
        build(name, shape, seed, out)


main()
