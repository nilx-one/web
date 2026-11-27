# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Build the two Avaia outfits from one articulated chassis, in metres, Y up."""

import json
import math
import struct
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import preview


def build(output, cleaner):
    materials = []
    for name, color, metal, roughness in [
        ("Porcelain", (0.89, 0.91, 0.96), 0.26, 0.28),
        ("Graphite", (0.045, 0.055, 0.075), 0.62, 0.31),
        ("Smoked glass", (0.012, 0.021, 0.046), 0.48, 0.13),
        ("Ice LED", (0.41, 0.86, 1), 0.1, 0.2),
        ("Saffron knit", (0.83, 0.43, 0.12), 0, 0.88),
        ("Canvas", (0.55, 0.40, 0.28), 0, 0.9),
        ("Alloy", (0.53, 0.60, 0.66), 0.82, 0.23),
    ]:
        material = dict(
            name=name,
            pbrMetallicRoughness=dict(
                baseColorFactor=[*(round(c**2.2, 6) for c in color), 1],
                metallicFactor=metal,
                roughnessFactor=roughness,
            ),
        )
        if name == "Ice LED":
            material["emissiveFactor"] = [0.24, 0.74, 1]
        materials.append(material)
    surfaces = {}
    nodes, meshes, accessors, views, animations = [], [], [], [], []
    data = bytearray()

    def buffer(values, kind, integer=False):
        values = np.asarray(values, dtype="<u2" if integer else "<f4")
        raw = values.tobytes()
        views.append(dict(buffer=0, byteOffset=len(data), byteLength=len(raw)))
        data.extend(raw + bytes(-len(raw) % 4))
        accessors.append(
            dict(
                bufferView=len(views) - 1,
                componentType=5123 if integer else 5126,
                count=len(values),
                type=kind,
                min=values.min(axis=0).reshape(-1).tolist(),
                max=values.max(axis=0).reshape(-1).tolist(),
            )
        )
        return len(accessors) - 1

    def joint(name, at, parent=None):
        index = len(nodes)
        nodes.append(dict(name=name, translation=list(at)))
        if parent is not None:
            nodes[parent].setdefault("children", []).append(index)
        return index

    def shell(name, center, radii, material, parent, power=1, tilt=0, arch=0):
        # Superellipsoids give the visor and helmet softly machined edges.
        def signed(v):
            return math.copysign(abs(v) ** power, v)

        vertices, faces = [], []
        rings, segments = 14, 28
        for row in range(rings + 1):
            lat = math.pi * (row / rings - 0.5)
            for col in range(segments):
                lon = 2 * math.pi * col / segments
                x = radii[0] * signed(math.cos(lat) * math.cos(lon))
                y = radii[1] * signed(math.sin(lat))
                z = radii[2] * signed(math.cos(lat) * math.sin(lon))
                y += arch * (1 - (x / radii[0]) ** 2)
                vertices.append(
                    [
                        center[0] + x * math.cos(tilt) - y * math.sin(tilt),
                        center[1] + x * math.sin(tilt) + y * math.cos(tilt),
                        center[2] + z,
                    ]
                )
                if row < rings:
                    a = row * segments + col
                    b = row * segments + (col + 1) % segments
                    if row:
                        faces.append([a, a + segments, b])
                    if row + 1 < rings:
                        faces.append([b, a + segments, b + segments])
        points = np.array(vertices)
        normals = np.zeros_like(points)
        for a, b, c in faces:
            normal = np.cross(points[b] - points[a], points[c] - points[a])
            normals[[a, b, c]] += normal
        normals[:segments] = [math.sin(tilt), -math.cos(tilt), 0]
        normals[-segments:] = [-math.sin(tilt), math.cos(tilt), 0]
        normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-14)
        surfaces.setdefault((parent, material), []).append(
            (points, normals, np.array(faces))
        )

    root = joint("Chassis", (0, 0, 0))
    head = joint("Head swivel", (0, 1.27, 0), root)
    shell("Neck bearing", (0, 1.25, 0), (0.073, 0.08, 0.073), 1, root)
    shell("Cranium", (0, 0.192, 0), (0.246, 0.197, 0.193), 0, head, 0.78)
    shell("Visor gasket", (0, 0.21, 0.106), (0.213, 0.145, 0.118), 1, head, 0.75)
    shell("Visor", (0, 0.213, 0.119), (0.207, 0.137, 0.113), 2, head, 0.75)
    for side in (-1, 1):
        shell(
            "Eye",
            (side * 0.083, 0.223, 0.231),
            (0.045, 0.010, 0.006),
            3,
            head,
            arch=0.034,
        )
        for i, (extent, mat) in enumerate(
            [(0.076, 0), (0.057, 1), (0.031, 3), (0.022, 2)]
        ):
            shell(
                f"Receiver {side}.{i}",
                (side * (0.229 + 0.009 * i), 0.160, 0),
                (0.019, extent, extent),
                mat,
                head,
            )
    shell("Smile", (0, 0.162, 0.228), (0.028, 0.005, 0.004), 3, head, arch=-0.009)
    shell("Chest", (0, 1.065, 0), (0.183, 0.17, 0.116), 0, root, 0.86)
    shell("Waist coupling", (0, 0.883, 0), (0.116, 0.095, 0.085), 1, root, 0.77)
    shell("Pelvis", (0, 0.786, 0), (0.150, 0.104, 0.106), 0, root, 0.82)
    joint("avaia_backpack_socket", (0, 0.83, -0.19), root)
    shell("Sternum inset", (0, 1.144, 0.090), (0.030, 0.030, 0.017), 1, root)
    shell("Power light", (0, 1.145, 0.105), (0.014, 0.014, 0.006), 3, root)
    for y in (0.872, 0.896):
        shell("Flexible abdominal seal", (0, y, 0), (0.121, 0.013, 0.091), 6, root)
    limbs = []
    for s in (-1, 1):
        shoulder = joint(f"Shoulder {s}", (s * 0.192, 1.146, 0), root)
        hip = joint(f"Hip {s}", (s * 0.083, 0.747, 0), root)
        limbs.extend([(shoulder, -s), (hip, s)])
        for name, center, radii, mat in [
            ("Shoulder joint", (0, 0, 0), (0.061, 0.061, 0.061), 1),
            ("Shoulder plate", (s * 0.021, -0.027, 0), (0.066, 0.065, 0.068), 0),
            ("Upper arm", (s * 0.025, -0.097, 0), (0.060, 0.109, 0.061), 0),
            ("Elbow", (s * 0.043, -0.204, 0), (0.046, 0.048, 0.049), 1),
            ("Forearm", (s * 0.044, -0.296, 0.018), (0.059, 0.10, 0.061), 0),
            ("Palm", (s * 0.043, -0.406, 0.032), (0.047, 0.055, 0.034), 1),
        ]:
            shell(f"{name} {s}", center, radii, mat, shoulder)
        for i in range(4):
            shell(
                f"Digit {s}.{i}",
                (s * 0.043 + (i - 1.5) * 0.019, -0.459 + 0.005 * abs(i - 1.5), 0.037),
                (0.009, 0.034, 0.014),
                1,
                shoulder,
                0.80,
            )
        shell(
            f"Thumb {s}",
            (s * 0.003, -0.421, 0.059),
            (0.015, 0.035, 0.015),
            1,
            shoulder,
            tilt=-s * 0.3,
        )
        for name, center, radii, mat in [
            ("Thigh", (0, -0.142, 0), (0.078, 0.165, 0.082), 0),
            ("Knee", (0, -0.32, 0.005), (0.062, 0.066, 0.065), 1),
            ("Knee plate", (0, -0.319, 0.044), (0.056, 0.052, 0.042), 0),
            ("Shin", (0, -0.48, -0.005), (0.072, 0.151, 0.072), 0),
            ("Ankle", (0, -0.627, 0), (0.051, 0.050, 0.053), 1),
            ("Foot", (0, -0.677, 0.045), (0.073, 0.063, 0.124), 0),
            ("Sole", (0, -0.719, 0.049), (0.075, 0.028, 0.127), 1),
        ]:
            shell(f"{name} {s}", center, radii, mat, hip, 0.90)
        if cleaner and s == 1:
            shell(
                "Mop handle",
                (0.048, -0.51, 0.070),
                (0.012, 0.60, 0.012),
                6,
                shoulder,
                0.65,
            )
            shell(
                "Mop shoe",
                (0.048, -1.103, 0.085),
                (0.133, 0.022, 0.056),
                1,
                shoulder,
                0.58,
            )
    if cleaner:
        shell("Beanie crown", (0, 0.342, -0.020), (0.248, 0.105, 0.194), 4, head, 0.84)
        shell("Knitted brim", (0, 0.318, -0.012), (0.254, 0.031, 0.196), 4, head, 0.75)
        shell("Dungarees", (0, 0.825, 0.012), (0.163, 0.141, 0.114), 5, root, 0.75)
        shell("Bib", (0, 1.003, 0.090), (0.137, 0.122, 0.043), 5, root, 0.65)
        for s in (-1, 1):
            shell(
                f"Strap {s}",
                (s * 0.104, 1.119, 0.092),
                (0.020, 0.107, 0.023),
                5,
                root,
                0.76,
                s * 0.16,
            )
            shell(
                f"Stud {s}", (s * 0.111, 1.067, 0.119), (0.012, 0.012, 0.007), 6, root
            )
        shell("Apron pocket", (0, 0.835, 0.112), (0.083, 0.052, 0.022), 4, root, 0.62)

    for (parent, material), pieces in surfaces.items():
        positions, normals, indices = [], [], []
        offset = 0
        for vertices, smooth_normals, faces in pieces:
            positions.append(vertices)
            normals.append(smooth_normals)
            indices.append(faces + offset)
            offset += len(vertices)
        primitive = dict(
            attributes=dict(
                POSITION=buffer(np.vstack(positions), "VEC3"),
                NORMAL=buffer(np.vstack(normals), "VEC3"),
            ),
            indices=buffer(np.concatenate(indices).ravel(), "SCALAR", True),
            material=material,
        )
        if "mesh" not in nodes[parent]:
            nodes[parent]["mesh"] = len(meshes)
            meshes.append(dict(name=nodes[parent]["name"], primitives=[]))
        meshes[nodes[parent]["mesh"]]["primitives"].append(primitive)

    times = buffer([0, 0.25, 0.5, 0.75, 1], "SCALAR")
    for name, tracks in [
        ("walk", [(node, amount * 0.43, 0) for node, amount in limbs]),
        ("idle", [(head, 0.025, 1)]),
        ("turn_in_place", [(head, 0.32, 1)]),
        ("wake", [(head, -0.14, 0)]),
        ("quiesce", [(head, 0.14, 0)]),
    ]:
        channels, samplers = [], []
        for target, amplitude, axis in tracks:
            angles = (
                [0, amplitude, 0, -amplitude, 0]
                if name in ("idle", "walk")
                else [0, amplitude / 2, amplitude, amplitude / 2, 0]
            )
            rotations = []
            for angle in angles:
                q = [0, 0, 0, math.cos(angle / 2)]
                q[axis] = math.sin(angle / 2)
                rotations.append(q)
            channels.append(
                dict(sampler=len(samplers), target=dict(node=target, path="rotation"))
            )
            samplers.append(dict(input=times, output=buffer(rotations, "VEC4")))
        animations.append(dict(name=name, channels=channels, samplers=samplers))
    doc = dict(
        asset=dict(version="2.0", copyright="© 2026 aiaiaiai · aiaiaiai.org"),
        scene=0,
        scenes=[dict(nodes=[root])],
        nodes=nodes,
        materials=materials,
        meshes=meshes,
        animations=animations,
        accessors=accessors,
        bufferViews=views,
        buffers=[dict(byteLength=len(data))],
    )

    def chunk(tag, payload, pad):
        payload += pad * (-len(payload) % 4)
        return struct.pack("<I4s", len(payload), tag) + payload

    key = "avaia-cleaner" if cleaner else "avaia"

    def write(path):
        payload = chunk(
            b"JSON", json.dumps(doc, separators=(",", ":")).encode(), b" "
        ) + chunk(b"BIN\0", bytes(data), b"\0")
        path.write_bytes(struct.pack("<4sII", b"glTF", 2, 12 + len(payload)) + payload)

    path = output / (key + ".glb")
    write(path)

    # The shared still renderer expects world-space vertices. Flatten the rest
    # pose only in the temporary preview copy, leaving the published rig intact.
    def flatten(index, offset):
        node = nodes[index]
        offset = offset + node["translation"]
        for primitive in meshes[node["mesh"]]["primitives"] if "mesh" in node else []:
            attrs = primitive["attributes"]
            acc = accessors[attrs["POSITION"]]
            view = views[acc["bufferView"]]
            coords = np.frombuffer(
                data, dtype="<f4", count=acc["count"] * 3, offset=view["byteOffset"]
            ).reshape(-1, 3)
            coords += offset
        for child in node.get("children", []):
            flatten(child, offset)

    flatten(root, np.zeros(3))
    with tempfile.TemporaryDirectory() as tmp:
        flat = Path(tmp) / "pose.glb"
        write(flat)
        pixels, *_ = preview.render(flat, 15)
        preview.write_png(output / (key + ".png"), pixels)


if __name__ == "__main__":
    destination = Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=True)
    for outfit in (False, True):
        build(destination, outfit)
