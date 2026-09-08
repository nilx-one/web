# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Deterministic procedural rig; geometry and bind pose share captured landmarks."""
import hashlib
import json
import struct
from collections import defaultdict

import numpy as np


TOPOLOGY = [("root", -1), ("hips", 0), ("spine", 1), ("chest", 2),
            ("neck", 3), ("head", 4), ("shoulder_L", 3), ("upperarm_L", 6),
            ("forearm_L", 7), ("hand_L", 8), ("shoulder_R", 3), ("upperarm_R", 10),
            ("forearm_R", 11), ("hand_R", 12), ("thigh_L", 1), ("shin_L", 14),
            ("foot_L", 15), ("toe_L", 16), ("thigh_R", 1), ("shin_R", 18),
            ("foot_R", 19), ("toe_R", 20)]
INDEX = {name: i for i, (name, _) in enumerate(TOPOLOGY)}
Y_UP = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float)


class Landmarks:
    def __init__(self):
        self.lofts = {}
        self.paths = {}

    def loft(self, name, sections):
        self.lofts[name] = np.asarray(sections, dtype=float)

    def tube(self, name, points):
        self.paths[name] = np.asarray(points, dtype=float)

    def skeleton(self):
        p = {"root": np.zeros(3)}
        for side in ("L", "R"):
            leg = self.lofts.get(side + "_jogger_leg", self.lofts.get(side + "_leg"))
            upper = leg[-1]
            p["thigh_" + side] = upper[[3, 4, 0]]
            # Knee is a deterministic midpoint of the central authoring sections.
            knee = (leg[2] + leg[-3]) / 2
            p["shin_" + side] = knee[[3, 4, 0]]
            shoe = self.lofts.get(side + "_shoe_upper",
                                  self.lofts.get(side + "_boot_foot",
                                                 self.lofts.get(side + "_boot_upper")))
            p["foot_" + side] = shoe[-1][[3, 4, 0]]
            front = shoe[np.argmax(shoe[:, 2])]
            p["toe_" + side] = np.array([front[3], front[4] - front[2] * .65, front[0]])
            sleeve = self.paths.get(side + "_sleeve", self.paths.get(side + "_jacket_sleeve"))
            p["upperarm_" + side] = sleeve[0]
            p["forearm_" + side] = sleeve[2]
            p["hand_" + side] = sleeve[-1]
            p["shoulder_" + side] = sleeve[0] * [0.5, 1, 1]
        p["hips"] = (p["thigh_L"] + p["thigh_R"]) / 2
        coat = self.lofts.get("anorak_shell",
                              self.lofts.get("tailored_jacket", self.lofts.get("overshirt_shell")))
        # Upper torso maximum depth; Dasha's flared hem is not her chest.
        upper_coat = coat[coat[:, 0] >= (coat[0, 0] + coat[-1, 0]) / 2]
        p["chest"] = upper_coat[np.argmax(upper_coat[:, 2])][[3, 4, 0]]
        p["spine"] = (p["hips"] + p["chest"]) / 2
        neck = self.lofts["neck"]
        p["neck"] = neck[0][[3, 4, 0]]
        p["head"] = neck[-1][[3, 4, 0]]
        return np.array([p[name] for name, _ in TOPOLOGY])


def smooth(value):
    t = np.clip(value, 0, 1)
    return t * t * (3 - 2 * t)


def weights_for(vertices, name, group, skeleton):
    """Same position + semantic part family always produces the same weights."""
    count = len(vertices)
    weights = np.zeros((count, len(TOPOLOGY)))
    side = name[0] if name.startswith(("L_", "R_")) else None

    def rigid(bone):
        weights[:, INDEX[bone]] = 1

    def vertical(bones, transitions, width):
        weights[:, INDEX[bones[0]]] = 1
        for previous, following, z in zip(bones, bones[1:], transitions):
            t = smooth((vertices[:, 2] - z + width) / (2 * width))
            weights[:, INDEX[previous]] -= t
            weights[:, INDEX[following]] += t

    if name == "neck":
        vertical(["chest", "neck", "head"],
                 [skeleton[INDEX["neck"], 2], skeleton[INDEX["head"], 2]], .035)
    elif group in ("head", "face", "hair"):
        rigid("head")
    elif group == "hands":
        rigid("hand_" + side)
    elif group in ("boots", "shoes"):
        # Tall boot shafts are hard shin parts, not hard foot parts.
        rigid(("shin_" if any(x in name for x in ("shaft", "boot_rim", "boot_back_seam")) else "foot_") + side)
    elif group == "details":
        # One bone per hard part, selected by centroid, never per-vertex tearing.
        nearest = 1 + np.argmin(np.linalg.norm(skeleton[1:] - vertices.mean(axis=0), axis=1))
        weights[:, nearest] = 1
    elif side and any(x in name for x in ("sleeve", "cuff", "shoulder")) and "jogger" not in name:
        bones = ["upperarm_" + side, "forearm_" + side, "hand_" + side]
        points = skeleton[[INDEX[b] for b in bones]]
        # Project to the polyline, preserving elbow/wrist arc length.
        vectors = np.diff(points, axis=0)
        lengths = np.linalg.norm(vectors, axis=1)
        t = np.clip(np.einsum("nsi,si->ns", vertices[:, None] - points[:-1], vectors) / lengths**2, 0, 1)
        projected = points[:-1] + t[:, :, None] * vectors
        segment = np.argmin(np.linalg.norm(vertices[:, None] - projected, axis=2), axis=1)
        along = (np.r_[0, np.cumsum(lengths)][segment] + t[np.arange(count), segment] * lengths[segment])
        elbow = smooth((along - lengths[0] + .05) / .10)
        wrist = smooth((along - lengths.sum() + .10) / .10)
        weights[:, INDEX[bones[0]]] = 1 - elbow
        weights[:, INDEX[bones[1]]] = elbow - wrist
        weights[:, INDEX[bones[2]]] = wrist
    elif side and ("jogger" in name or name == side + "_leg"):
        vertical(["shin_" + side, "thigh_" + side, "hips"],
                 [skeleton[INDEX["shin_" + side], 2], skeleton[INDEX["thigh_" + side], 2]], .06)
    else:
        vertical(["hips", "spine", "chest"],
                 [skeleton[INDEX["spine"], 2], skeleton[INDEX["chest"], 2]], .06)
    weights = np.maximum(weights, 0)
    joints = np.argsort(-weights, axis=1, kind="stable")[:, :4]
    values = np.take_along_axis(weights, joints, axis=1)
    if np.any(values.sum(axis=1) == 0):
        raise ValueError("unweighted vertex: " + name)
    joints[values == 0] = 0
    values /= values.sum(axis=1, keepdims=True)
    return joints.astype("<u2"), values.astype("<f4")


class Glb:
    def __init__(self):
        self.data = bytearray()
        self.doc = {"asset": {"version": "2.0", "generator": "nilx-one procedural avatar 0.1.0",
                              "copyright": "© 2026 aiaiaiai · aiaiaiai.org"},
                    "accessors": [], "bufferViews": []}

    def accessor(self, data, kind, component=5126, bounds=False):
        # Canonical export precision removes CPU/libm rounding noise, including
        # signed zero. Positions retain 0.1 micrometre resolution.
        if component == 5126:
            data = np.round(data.astype(np.float64), 7).astype("<f4")
            data[data == 0] = 0
        data = np.ascontiguousarray(data)
        while len(self.data) % 4:
            self.data.append(0)
        views, accessors = self.doc["bufferViews"], self.doc["accessors"]
        views.append({"buffer": 0, "byteOffset": len(self.data), "byteLength": data.nbytes})
        self.data.extend(data.tobytes())
        value = {"bufferView": len(views) - 1, "componentType": component,
                 "count": len(data), "type": kind}
        if bounds:
            value.update(min=np.atleast_1d(data.min(axis=0)).tolist(), max=np.atleast_1d(data.max(axis=0)).tolist())
        accessors.append(value)
        return len(accessors) - 1

    def write(self, path):
        self.doc["buffers"] = [{"byteLength": len(self.data)}]
        raw = json.dumps(self.doc, separators=(",", ":"), ensure_ascii=False).encode()
        raw += b" " * (-len(raw) % 4)
        self.data.extend(b"\0" * (-len(self.data) % 4))
        path.write_bytes(struct.pack("<III", 0x46546C67, 2, 28 + len(raw) + len(self.data))
                         + struct.pack("<II", len(raw), 0x4E4F534A) + raw
                         + struct.pack("<II", len(self.data), 0x004E4942) + self.data)


def clips(glb):
    animations = []
    for name, duration, loop in [("idle", 3., True), ("walk", 1.2, True),
                                  ("turn_in_place", 1., False), ("wake", 1.5, False), ("quiesce", 1.5, False)]:
        times = np.linspace(0, duration, 25, dtype="<f4")
        phase = times / duration
        wave = np.sin(phase * 2 * np.pi)
        pulse = np.sin(phase * np.pi)**2
        tracks = {"chest": (.012 * wave, 0)}
        if name == "walk":
            for side, sign in [("L", 1), ("R", -1)]:
                tracks["thigh_" + side] = (.22 * wave * sign, 0)
                tracks["shin_" + side] = (.18 * np.maximum(0, wave * sign), 0)
                tracks["upperarm_" + side] = (-.12 * wave * sign, 0)
        elif name == "turn_in_place":
            tracks["hips"] = (.16 * pulse, 1)
            tracks["head"] = (.22 * pulse, 1)
        elif name == "wake":
            tracks["head"] = (-.08 * pulse, 0)
            tracks["chest"] = (-.035 * pulse, 0)
        elif name == "quiesce":
            tracks["head"] = (.08 * pulse, 0)
            tracks["forearm_L"] = (-.13 * pulse, 0)
        animation = {"name": name, "channels": [], "samplers": [], "extras": {"loop": loop, "inPlace": True}}
        time_accessor = glb.accessor(times, "SCALAR", bounds=True)
        for bone, (angle, axis) in tracks.items():
            quat = np.zeros((len(times), 4), dtype="<f4")
            quat[:, axis] = np.sin(angle / 2)
            quat[:, 3] = np.cos(angle / 2)
            animation["channels"].append({"sampler": len(animation["samplers"]), "target": {"node": INDEX[bone], "path": "rotation"}})
            animation["samplers"].append({"input": time_accessor, "output": glb.accessor(quat, "VEC4"), "interpolation": "LINEAR"})
        animations.append(animation)
    return animations


def export_avatar(parts, palette, skeleton, landmarks, out, model_id):
    glb = Glb()
    positions = skeleton @ Y_UP.T
    nodes = []
    for i, (name, parent) in enumerate(TOPOLOGY):
        node = {"name": name, "translation": (positions[i] - (positions[parent] if parent >= 0 else 0)).tolist()}
        children = [j for j, (_, p) in enumerate(TOPOLOGY) if p == i]
        if children:
            node["children"] = children
        nodes.append(node)
    inverse = np.tile(np.eye(4), (len(nodes), 1, 1))
    inverse[:, :3, 3] = -positions
    ibm = glb.accessor(inverse.transpose(0, 2, 1).reshape(-1, 16).astype("<f4"), "MAT4")
    materials = []
    primitives = []
    records = []
    grouped = defaultdict(list)
    for name, mesh, material, group in parts:
        grouped[material].append((name, mesh, group))
    for material, entries in grouped.items():
        color, roughness, metallic = palette[material]
        materials.append({"name": material, "doubleSided": True, "pbrMetallicRoughness": {
            "baseColorFactor": [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)] + [1],
            "roughnessFactor": roughness, "metallicFactor": metallic}})
        vertices, normals, indices, joints, weights = [], [], [], [], []
        offset = 0
        for name, mesh, group in entries:
            js, ws = weights_for(mesh.vertices, name, group, skeleton)
            vertices.append(mesh.vertices @ Y_UP.T)
            normals.append(mesh.vertex_normals @ Y_UP.T)
            indices.append(mesh.faces + offset)
            joints.append(js)
            weights.append(ws)
            records.append({"name": name, "group": group, "material": material,
                            "primitive": len(primitives), "vertex_offset": offset, "vertex_count": len(mesh.vertices)})
            offset += len(mesh.vertices)
        primitives.append({"attributes": {
            "POSITION": glb.accessor(np.vstack(vertices).astype("<f4"), "VEC3", bounds=True),
            "NORMAL": glb.accessor(np.vstack(normals).astype("<f4"), "VEC3"),
            "JOINTS_0": glb.accessor(np.vstack(joints), "VEC4", 5123),
            "WEIGHTS_0": glb.accessor(np.vstack(weights), "VEC4")},
            "indices": glb.accessor(np.vstack(indices).reshape(-1).astype("<u4"), "SCALAR", 5125),
            "material": len(materials) - 1})
    for primitive in primitives:
        for accessor_id in primitive["attributes"].values():
            glb.doc["bufferViews"][glb.doc["accessors"][accessor_id]["bufferView"]]["target"] = 34962
        glb.doc["bufferViews"][glb.doc["accessors"][primitive["indices"]]["bufferView"]]["target"] = 34963
    nodes.append({"name": model_id, "mesh": 0, "skin": 0})
    glb.doc.update(nodes=nodes, skins=[{"name": "shared-study-rig", "joints": list(range(len(TOPOLOGY))), "skeleton": 0, "inverseBindMatrices": ibm}],
                   meshes=[{"name": model_id, "primitives": primitives}], materials=materials,
                   animations=clips(glb), scenes=[{"nodes": [0, len(TOPOLOGY)]}], scene=0)
    path = out / (model_id + ".glb")
    glb.write(path)
    manifest = {"model_id": model_id, "version": "0.1.0", "authoring_up": "Z", "export_up": "Y",
                "skeleton": {"bones": [b for b, _ in TOPOLOGY], "parents": [p for _, p in TOPOLOGY],
                             "rest_translations": [n["translation"] for n in nodes[:-1]]},
                "skin": {"influences_per_vertex": 4, "primitive_count": len(primitives)},
                "parts": records, "palette": palette, "mesh_count": len(parts),
                "vertices": sum(len(p[1].vertices) for p in parts), "triangles": sum(len(p[1].faces) for p in parts),
                "size_bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "clips": [a["name"] for a in glb.doc["animations"]],
                "design": "User-supplied artistic study; not biometric or presence evidence. In-place animation; no IK."}
    (out / (model_id + ".manifest.json")).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: manifest[k] for k in ("model_id", "vertices", "triangles", "size_bytes", "sha256")}))
