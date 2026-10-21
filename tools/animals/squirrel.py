# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
"""Build the map's low-poly red squirrel as a rigged, animated GLB.

Run with Blender's Python module (`pip install bpy==5.2.2`):

    python -I tools/animals/squirrel.py <output dir>

The squirrel is generated here rather than taken from a pack: no low-poly,
rigged squirrel under a public-domain dedication was found. Every part is
bound wholly to one bone, so the body moves as a few rigid pieces, as the
pack's animals do. It is metre-scale, Y-up, faces glTF +Z and stands on y = 0;
its clips are `idle`, `run` (bounding, in place) and `eat` (sitting up,
nibbling).
"""

import math
import random
import sys
from pathlib import Path

import bpy  # noqa: I001 - Blender's module must load before bmesh exists
import bmesh
from mathutils import Euler, Vector

COLOURS = {"fur": "#c4622d", "cream": "#f0dcba", "dark": "#2a201c"}
FPS = 24

# Blender is Z-up and the squirrel faces -Y, which glTF calls +Z.
BONES = [
    # name, parent, head, tail
    ("body", None, (0, 0.07, 0.11), (0, -0.07, 0.13)),
    ("head", "body", (0, -0.07, 0.14), (0, -0.15, 0.17)),
    ("tail1", "body", (0, 0.08, 0.11), (0, 0.15, 0.17)),
    ("tail2", "tail1", (0, 0.15, 0.17), (0, 0.17, 0.27)),
    ("tail3", "tail2", (0, 0.17, 0.27), (0, 0.13, 0.34)),
    ("front_L", "body", (0.03, -0.05, 0.09), (0.03, -0.06, 0.0)),
    ("front_R", "body", (-0.03, -0.05, 0.09), (-0.03, -0.06, 0.0)),
    ("back_L", "body", (0.04, 0.05, 0.1), (0.04, 0.03, 0.0)),
    ("back_R", "body", (-0.04, 0.05, 0.1), (-0.04, 0.03, 0.0)),
]


def linear(hex_colour):
    def channel(value):
        c = value / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (*[channel(int(hex_colour[i:i + 2], 16)) for i in (1, 3, 5)], 1.0)


def material(name):
    made = bpy.data.materials.new(name)
    made.use_nodes = True
    bsdf = next(n for n in made.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = linear(COLOURS[name])
    bsdf.inputs["Roughness"].default_value = 0.9
    return made


PARTS = []  # (bone, material, verts-maker)


def ellipsoid(bm, centre, radii, rng, subdivisions=2, jitter=0.06):
    made = bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
    for v in made["verts"]:
        n = v.co.normalized()
        k = 1 + rng.uniform(-jitter, jitter)
        v.co = Vector((n.x * radii[0], n.y * radii[1], n.z * radii[2])) * k + Vector(centre)
    return made["verts"]


def cone(bm, base, tip, radius, sides=5):
    made = bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=radius,
                                 radius2=0.0, depth=1.0)
    axis = Vector(tip) - Vector(base)
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    # A zero top radius welds the tip into one vertex; the rest are gone.
    verts = [v for v in made["verts"] if v.is_valid]
    for v in verts:
        local = Vector((v.co.x, v.co.y, (v.co.z + 0.5) * axis.length))
        v.co = rot @ local + Vector(base)
    return verts


def leg(bm, top, bottom, radius):
    made = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=radius,
                                 radius2=radius * 0.8, depth=1.0)
    axis = Vector(bottom) - Vector(top)
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    for v in made["verts"]:
        local = Vector((v.co.x, v.co.y, (v.co.z + 0.5) * axis.length))
        v.co = rot @ local + Vector(top)
    return made["verts"]


def build_parts(rng, materials):
    """Each part is its own object, bound wholly to one bone, then joined."""
    parts = []

    def add(make, bone, colour):
        bm = bmesh.new()
        make(bm)
        mesh = bpy.data.meshes.new(f"{bone}-{colour}-{len(parts)}")
        for m in materials:
            mesh.materials.append(m)
        index = list(COLOURS).index(colour)
        for face in bm.faces:
            face.material_index = index
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
        parts.append(obj)

    add(lambda bm: ellipsoid(bm, (0, 0, 0.115), (0.052, 0.095, 0.06), rng), "body", "fur")
    add(lambda bm: ellipsoid(bm, (0, -0.03, 0.1), (0.04, 0.065, 0.045), rng), "body", "cream")
    add(lambda bm: ellipsoid(bm, (0, -0.11, 0.158), (0.042, 0.048, 0.042), rng), "head", "fur")
    add(lambda bm: ellipsoid(bm, (0, -0.152, 0.148), (0.022, 0.024, 0.02), rng), "head", "cream")
    for side, name in ((1, "L"), (-1, "R")):
        add(lambda bm, s=side: cone(bm, (0.022 * s, -0.1, 0.19), (0.026 * s, -0.098, 0.228), 0.012),
            "head", "fur")
        add(lambda bm, s=side: ellipsoid(bm, (0.03 * s, -0.142, 0.17), (0.007, 0.006, 0.008), rng,
                                         subdivisions=1, jitter=0), "head", "dark")
        add(lambda bm, s=side: leg(bm, (0.03 * s, -0.05, 0.09), (0.03 * s, -0.06, 0.004), 0.011),
            "front_" + name, "fur")
        add(lambda bm, s=side: ellipsoid(bm, (0.038 * s, 0.045, 0.085), (0.026, 0.045, 0.04), rng),
            "back_" + name, "fur")
        add(lambda bm, s=side: ellipsoid(bm, (0.04 * s, 0.02, 0.012), (0.013, 0.03, 0.01), rng,
                                         subdivisions=1), "back_" + name, "fur")
        add(lambda bm, s=side: leg(bm, (0.04 * s, 0.05, 0.075), (0.04 * s, 0.03, 0.012), 0.013),
            "back_" + name, "fur")
    # The tail is the squirrel: three fluffy pieces curling up over its back.
    add(lambda bm: ellipsoid(bm, (0, 0.12, 0.14), (0.04, 0.05, 0.05), rng, jitter=0.12), "tail1", "fur")
    add(lambda bm: ellipsoid(bm, (0, 0.165, 0.225), (0.048, 0.045, 0.06), rng, jitter=0.12), "tail2", "fur")
    add(lambda bm: ellipsoid(bm, (0, 0.15, 0.31), (0.045, 0.05, 0.045), rng, jitter=0.12), "tail3", "fur")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = body.data.name = "Squirrel"
    return body


def build(out):
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    rng = random.Random(31)

    arm_data = bpy.data.armatures.new("SquirrelArmature")
    arm = bpy.data.objects.new("SquirrelArmature", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    edit = {}
    for name, parent, head, tail in BONES:
        bone = arm_data.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        if parent is not None:
            bone.parent = edit[parent]
        edit[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")

    materials = [material(name) for name in COLOURS]
    body = build_parts(rng, materials)
    mesh = body.data
    body.parent = arm
    body.modifiers.new("Armature", "ARMATURE").object = arm

    arm.animation_data_create()
    for clip, frames, pose in CLIPS:
        action = bpy.data.actions.new(clip)
        action.use_fake_user = True
        arm.animation_data.action = action
        for frame in range(0, frames + 1, 2):
            t = frame / frames
            for bone in arm.pose.bones:
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = Euler((0, 0, 0))
                bone.location = Vector((0, 0, 0))
            pose(arm.pose.bones, t)
            for bone in arm.pose.bones:
                bone.keyframe_insert("rotation_euler", frame=frame)
                bone.keyframe_insert("location", frame=frame)
    arm.animation_data.action = bpy.data.actions["idle"]

    path = out / "squirrel.glb"
    bpy.context.scene.render.fps = FPS
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_yup=True,
                              export_animations=True, export_animation_mode="ACTIONS",
                              export_cameras=False, export_lights=False, export_extras=False)
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    print(f"built squirrel.glb: tris={tris} clips={[a.name for a in bpy.data.actions]} "
          f"bytes={path.stat().st_size}")


TAU = 2 * math.pi


def idle(b, t):
    # Alert: the tail sways, the head glances one way and the other.
    b["tail1"].rotation_euler.y = 0.12 * math.sin(TAU * t)
    b["tail2"].rotation_euler.x = 0.1 * math.sin(TAU * t + 0.6)
    b["tail3"].rotation_euler.x = 0.15 * math.sin(TAU * t + 1.2)
    b["head"].rotation_euler.z = 0.35 * math.sin(TAU * t)
    b["body"].location.z = 0.002 * math.sin(2 * TAU * t)


def run(b, t):
    # A bound, in place: front and back pairs land in turn, the tail waves.
    s = math.sin(TAU * t)
    b["body"].rotation_euler.x = 0.18 * s
    b["body"].location.z = 0.012 * max(0.0, math.sin(TAU * t + 0.8))
    for side in ("L", "R"):
        b["front_" + side].rotation_euler.x = 0.7 * s
        b["back_" + side].rotation_euler.x = -0.7 * s
    b["tail1"].rotation_euler.x = -0.25 * s
    b["tail2"].rotation_euler.x = -0.2 * math.sin(TAU * t + 0.5)
    b["tail3"].rotation_euler.x = -0.25 * math.sin(TAU * t + 1.0)
    b["head"].rotation_euler.x = -0.12 * s


def eat(b, t):
    # Sat up on its haunches, a nut held to its mouth, nibbling.
    b["body"].rotation_euler.x = -0.85
    b["body"].location.z = 0.02
    for side in ("L", "R"):
        b["front_" + side].rotation_euler.x = -1.2 + 0.12 * math.sin(4 * TAU * t)
        b["back_" + side].rotation_euler.x = 0.75
    b["head"].rotation_euler.x = 0.55 + 0.08 * math.sin(4 * TAU * t)
    b["tail1"].rotation_euler.x = 0.35
    b["tail2"].rotation_euler.x = 0.1 * math.sin(TAU * t)


CLIPS = [("idle", 48, idle), ("run", 12, run), ("eat", 48, eat)]


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = Path(args[0])
    out.mkdir(parents=True, exist_ok=True)
    build(out)


main()
