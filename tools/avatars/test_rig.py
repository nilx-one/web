# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Independent GLB checks, including reconstruction of bind-space vertices."""
import hashlib
import json
import struct
import unittest
from pathlib import Path

import numpy as np

from rig import TOPOLOGY, INDEX, weights_for

ASSETS = Path(__file__).resolve().parents[2] / "deploy/web/avatars/0.1.0"


def read_glb(path):
    raw = path.read_bytes()
    magic, version, length, json_length, kind = struct.unpack_from("<5I", raw)
    assert (magic, version, length, kind) == (0x46546C67, 2, len(raw), 0x4E4F534A)
    doc = json.loads(raw[20:20 + json_length])
    binary = raw[28 + json_length:]

    def accessor(index):
        a = doc["accessors"][index]
        view = doc["bufferViews"][a["bufferView"]]
        width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        dtype = {5126: "<f4", 5123: "<u2", 5125: "<u4"}[a["componentType"]]
        return np.frombuffer(binary, dtype=dtype, count=a["count"] * width,
                             offset=view.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(-1, width)
    return doc, accessor


class RigTests(unittest.TestCase):
    def test_exported_assets(self):
        for model in ("sky", "dasha", "kai", "dasha-v2"):
            with self.subTest(model=model):
                directory = ASSETS if model != "dasha-v2" else ASSETS.parent / "0.3.0"
                path = directory / (model + "-study.glb")
                manifest = json.loads(path.with_suffix(".manifest.json").read_text())
                doc, read = read_glb(path)
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), manifest["sha256"])
                self.assertEqual([n["name"] for n in doc["nodes"][:len(TOPOLOGY)]],
                                 [n for n, _ in TOPOLOGY])
                self.assertEqual(len(TOPOLOGY), 22)
                modular = manifest.get("modular", False)
                self.assertEqual(doc["skins"][0]["joints"], list(range(22)))
                world = []
                for i, (_, parent) in enumerate(TOPOLOGY):
                    m = np.eye(4)
                    m[:3, 3] = doc["nodes"][i]["translation"]
                    world.append(world[parent] @ m if parent >= 0 else m)
                inverse = read(doc["skins"][0]["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
                skin = np.array(world) @ inverse
                np.testing.assert_allclose(skin, np.tile(np.eye(4), (22, 1, 1)), atol=2e-7)
                # A modular character carries one mesh per body region and per
                # wearable; a baked study carries a single mesh. Every check
                # below is about the geometry, so both shapes read the same
                # list of primitives.
                by_node = {mesh["name"]: mesh["primitives"] for mesh in doc["meshes"]}
                primitives = [p for mesh in doc["meshes"] for p in mesh["primitives"]]
                self.assertLessEqual(len(primitives), 60 if modular else 23)
                self.assertGreaterEqual(len(primitives), len(doc["materials"]))
                if modular:
                    self.assertEqual(len(by_node), len(doc["meshes"]))
                    for node in doc["nodes"][len(TOPOLOGY):]:
                        self.assertEqual(node["skin"], 0)
                vertices = triangles = 0
                for p in primitives:
                    attrs = p["attributes"]
                    pos, weights, joints = (read(attrs[k]) for k in ("POSITION", "WEIGHTS_0", "JOINTS_0"))
                    self.assertTrue(np.isfinite(pos).all() and np.isfinite(weights).all())
                    self.assertTrue((weights >= 0).all() and (joints < 22).all())
                    np.testing.assert_allclose(weights.sum(axis=1), 1, atol=1e-6)
                    self.assertLess(int(read(p["indices"]).max()), len(pos))
                    homogeneous = np.column_stack([pos, np.ones(len(pos))])
                    deformed = np.einsum("nk,nkij,nj->ni", weights, skin[joints], homogeneous)
                    np.testing.assert_allclose(deformed[:, :3], pos, atol=5e-7)
                    vertices += len(pos)
                    triangles += len(read(p["indices"])) // 3
                self.assertEqual(vertices, manifest["vertices"])
                self.assertEqual(triangles, manifest["triangles"])
                self.assertEqual({a["name"] for a in doc["animations"]}, {"idle", "walk", "turn_in_place", "wake", "quiesce"})
                for a in doc["animations"]:
                    for channel in a["channels"]:
                        self.assertEqual(channel["target"]["path"], "rotation")
                        sampler = a["samplers"][channel["sampler"]]
                        self.assertTrue((np.diff(read(sampler["input"])[:, 0]) > 0).all())
                        q = read(sampler["output"])
                        np.testing.assert_allclose(np.linalg.norm(q, axis=1), 1, atol=1e-6)
                        np.testing.assert_allclose(q[0], q[-1], atol=1e-6)
                for part in manifest["parts"]:
                    rigid = (part.get("family") in ("head", "hand", "foot", "nearest")
                             if modular else
                             part["group"] in ("shoes", "boots", "head", "face", "hair",
                                               "details", "hands") and part["name"] != "neck")
                    if rigid:
                        owner = by_node[part["node"]] if modular else primitives
                        weights = read(owner[part["primitive"]]["attributes"]["WEIGHTS_0"])
                        weights = weights[part["vertex_offset"]:part["vertex_offset"] + part["vertex_count"]]
                        self.assertTrue(((weights > 0).sum(axis=1) == 1).all(), part["name"])

    def test_shared_clips_are_identical_across_bind_poses(self):
        # Every study answers the same clip in the same rotations, so a person
        # choosing a model changes the body and nothing about how it moves.
        a, read_a = read_glb(ASSETS / "sky-study.glb")
        for model in ("dasha", "kai", "dasha-v2"):
            directory = ASSETS if model != "dasha-v2" else ASSETS.parent / "0.3.0"
            b, read_b = read_glb(directory / (model + "-study.glb"))
            for clip_a, clip_b in zip(a["animations"], b["animations"], strict=True):
                self.assertEqual(clip_a["channels"], clip_b["channels"])
                for x, y in zip(clip_a["samplers"], clip_b["samplers"], strict=True):
                    np.testing.assert_array_equal(read_a(x["output"]), read_b(y["output"]))

    def test_modular_character_publishes_what_the_wardrobe_offers(self):
        # Identity and wardrobe are one skeleton in one asset: an outfit change
        # is a visibility change, never a second character being fetched. What
        # a person can choose and what actually has geometry are checked
        # against the one table both the asset build and Web read.
        directory = ASSETS.parent / "0.3.0"
        manifest = json.loads((directory / "dasha-v2-study.manifest.json").read_text())
        table = json.loads((Path(__file__).resolve().parent / "dasha2/wardrobe.json").read_text())
        doc, _ = read_glb(directory / "dasha-v2-study.glb")

        self.assertTrue(manifest["modular"])
        self.assertEqual(manifest["rig_version"], table["rig_version"])
        names = [node["name"] for node in doc["nodes"][len(TOPOLOGY):]]
        self.assertEqual(len(names), len(set(names)))
        expected = ["body:" + r for r in table["always_visible"] + table["body_regions"]]
        expected += ["wear:" + item["id"] for item in table["items"]]
        self.assertEqual(names, expected)
        self.assertEqual([n["name"] for n in manifest["nodes"]], expected)
        for node in manifest["nodes"]:
            self.assertGreater(node["vertices"], 0, node["name"])

        published = set(table["body_regions"])
        for item in table["items"]:
            self.assertLessEqual(set(item["hides"]), published, item["id"])
        offered = {item["id"] for item in table["items"]}
        for worn in table["default_outfit"].values():
            for item_id in ([worn] if isinstance(worn, str) else worn):
                self.assertIn(item_id, offered)
        # Nothing a person can put on may leave the head or hands hidden: a
        # body that could lose its own face to a change of clothes is not the
        # same body afterwards.
        self.assertEqual(set(table["always_visible"]) & published, set())

    def test_hard_part_uses_one_bone_even_across_nearest_joint_boundary(self):
        skeleton = np.arange(66).reshape(22, 3)
        vertices = np.array([[0., 0., 0.], [63., 64., 65.]])
        joints, weights = weights_for(vertices, "zip", "details", skeleton)
        self.assertEqual(joints[0, 0], joints[1, 0])
        np.testing.assert_array_equal(weights[:, 0], 1)
        joints, _ = weights_for(vertices, "L_boot_shaft", "boots", skeleton)
        self.assertTrue((joints[:, 0] == INDEX["shin_L"]).all())

    def test_named_family_binds_without_reading_the_part_name(self):
        # A bare thigh and a trouser leg follow the same bones without either
        # having to be named after the other.
        skeleton = np.arange(66).reshape(22, 3).astype(float)
        vertices = np.array([[0., 0., 0.], [1., 2., 3.]])
        joints, _ = weights_for(vertices, "L_whatever", "bare", skeleton, "foot")
        self.assertTrue((joints[:, 0] == INDEX["foot_L"]).all())
        joints, _ = weights_for(vertices, "R_whatever", "bare", skeleton, "hand")
        self.assertTrue((joints[:, 0] == INDEX["hand_R"]).all())
        with self.assertRaises(ValueError):
            weights_for(vertices, "x", "bare", skeleton, "not-a-family")


if __name__ == "__main__":
    unittest.main()
