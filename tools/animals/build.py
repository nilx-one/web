# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
"""Convert Quaternius Animal Pack Vol.2 FBX files into the GLBs the map draws.

Run with Blender's Python module (`pip install bpy==5.2.2`):

    python -I tools/animals/build.py <extracted pack dir> <output dir>

The pack's colours lived in Blender Internal materials, which neither its FBX
nor its OBJ files carry, so each material gets the colour of the pack's own
preview render, by name. Every GLB is metre-scale, Y-up, faces glTF +Z, has
its feet (or belly) on y = 0 and its clips under short lower-case names.
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ANIMALS = {
    # name: FBX stem, where the head is, the measured extent and its metres,
    # the clip renames, a triangle budget.
    "dog": dict(fbx="Dog", head="top:0.12", extent="length", metres=0.9,
                clips={"Idle": "idle", "Walking": "walk"}, tris=None,
                colours={"Dog": "#8a8984"}),
    "cat": dict(fbx="Cat", head="material:Pink", extent="length", metres=0.5,
                clips={"Idle": "idle", "Walking": "walk"}, tris=None,
                colours={"Grey": "#4a4748", "White": "#e6e6e6", "Pink": "#ecb9e3"}),
    "eagle": dict(fbx="Eagle", head="material:Beak", extent="span", metres=1.9,
                  clips={"Flying": "fly", "Idle": "idle"}, tris=2400,
                  colours={"Wings": "#4f3122", "Head": "#f5f5f5", "Beak": "#ffd95c", "Claws": "#d6a64d"}),
    "piranha": dict(fbx="Piranha", head="material:White", extent="length", metres=0.3,
                    clips={"Swimming": "swim", "Bite": "bite"}, tris=None,
                    colours={"Brown": "#c78275", "LightYellow": "#fff1d1", "Black": "#131313", "White": "#f2f2f2"}),
}


def linear(hex_colour):
    def channel(value):
        c = value / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    rgb = [int(hex_colour[i:i + 2], 16) for i in (1, 3, 5)]
    return (*[channel(v) for v in rgb], 1.0)


def world_points(mesh):
    return [mesh.matrix_world @ v.co for v in mesh.data.vertices]


def bounds(points):
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    return lo, hi


def head_point(spec, arm, mesh):
    kind, name = spec["head"].split(":")
    if kind == "top":
        # The highest slice of the body: a dog's head rises above its tail.
        points = world_points(mesh)
        lo, hi = bounds(points)
        floor = hi.z - (hi.z - lo.z) * float(name)
        top = [p for p in points if p.z >= floor]
        return sum(top, Vector()) / len(top)
    index = next(i for i, m in enumerate(mesh.data.materials) if m and m.name == name)
    verts = {v for p in mesh.data.polygons if p.material_index == index for v in p.vertices}
    points = [mesh.matrix_world @ mesh.data.vertices[v].co for v in verts]
    return sum(points, Vector()) / len(points)


def build(name, spec, pack, out):
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
    bpy.ops.wm.fbx_import(filepath=str(pack / "FBX" / f"{spec['fbx']}.fbx"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    for obj in list(bpy.data.objects):
        if obj not in (arm, mesh):
            bpy.data.objects.remove(obj, do_unlink=True)

    for material in mesh.data.materials:
        material.use_nodes = True
        bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        material.name = material.name.split(".")[0]
        bsdf.inputs["Base Color"].default_value = linear(spec["colours"][material.name])
        bsdf.inputs["Roughness"].default_value = 0.85
        bsdf.inputs["Metallic"].default_value = 0.0

    if spec["tris"] is not None:
        tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
        if tris > spec["tris"]:
            bpy.context.view_layer.objects.active = mesh
            decimate = mesh.modifiers.new("Decimate", "DECIMATE")
            decimate.ratio = spec["tris"] / tris
            while mesh.modifiers[0] != decimate:
                bpy.ops.object.modifier_move_up(modifier=decimate.name)
            bpy.ops.object.modifier_apply(modifier=decimate.name)

    for action in bpy.data.actions:
        clip = action.name.split("|")[-1]
        action.name = spec["clips"].get(clip, clip.lower())

    # The clips animate the armature object itself, so the body is placed by
    # a root of its own above it rather than by the armature's transform.
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    arm.parent = root
    bpy.context.view_layer.update()

    # Turn the body so its head points along Blender -Y, which glTF calls +Z.
    lo, hi = bounds(world_points(mesh))
    centre = (lo + hi) / 2
    forward = head_point(spec, arm, mesh) - centre
    forward.z = 0
    root.rotation_euler.z = -math.pi / 2 - math.atan2(forward.y, forward.x)
    bpy.context.view_layer.update()

    lo, hi = bounds(world_points(mesh))
    size = hi - lo
    measured = size.x if spec["extent"] == "span" else size.y
    root.scale = Vector((1, 1, 1)) * (spec["metres"] / measured)
    bpy.context.view_layer.update()
    lo, hi = bounds(world_points(mesh))
    root.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    bpy.context.view_layer.update()

    path = out / f"{name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_apply=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    lo, hi = bounds(world_points(mesh))
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    print(f"built {path.name}: tris={tris} size={tuple(round(v, 3) for v in hi - lo)} "
          f"clips={sorted(a.name for a in bpy.data.actions)} bytes={path.stat().st_size}")


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    pack, out = Path(args[0]), Path(args[1])
    out.mkdir(parents=True, exist_ok=True)
    for name, spec in ANIMALS.items():
        build(name, spec, pack, out)


main()
