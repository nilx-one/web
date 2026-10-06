# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Inventory reports observed metadata and fails visibly on unreadable inputs."""
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from inventory import discover_glbs, inspect_glb, inventory, main


def glb(doc):
    payload = json.dumps(doc).encode()
    payload += b" " * (-len(payload) % 4)
    return struct.pack("<5I", 0x46546C67, 2, 20 + len(payload), len(payload), 0x4E4F534A) + payload


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def write(self, doc):
        path = self.root / "model.glb"
        path.write_bytes(glb(doc))
        return path

    def test_static_mesh_is_not_claimed_as_rigged(self):
        doc = {"asset": {"version": "2.0"}, "accessors": [{"count": 3}],
               "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}]}
        path = self.write(doc)
        before = path.read_bytes()
        result = inspect_glb(path)
        self.assertEqual(result["skins"], [])
        self.assertEqual(result["animations"], [])
        self.assertFalse(result["meshes"][0]["primitives"][0]["has_skin_attributes"])
        self.assertEqual(path.read_bytes(), before)

    def test_rig_metadata_and_missing_inverse_are_distinguished(self):
        doc = {"asset": {"version": "2.0"}, "nodes": [{"name": "hips"}, {"mesh": 0, "skin": 0}],
               "skins": [{"joints": [0]}], "accessors": [{"count": 3}],
               "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "JOINTS_0": 0, "WEIGHTS_0": 0}}]}],
               "animations": [{"name": "idle", "channels": [{"sampler": 0, "target": {"node": 0, "path": "rotation"}}],
                               "samplers": [{"input": 0, "output": 0}]}]}
        result = inspect_glb(self.write(doc))
        self.assertEqual(result["skins"][0]["joint_names"], ["hips"])
        self.assertIsNone(result["skins"][0]["inverse_bind_matrices"])
        self.assertEqual(result["skin_bindings"], [{"node": 1, "mesh": 0, "skin": 0}])
        self.assertEqual(result["animations"][0]["target_paths"], ["rotation"])
        doc["skins"][0]["inverseBindMatrices"] = 0
        self.assertEqual(inspect_glb(self.write(doc))["skins"][0]["inverse_bind_matrices"], {"count": 3})

    def test_bad_references_are_errors_not_python_negative_indices(self):
        for joint in (-1, 1, True):
            with self.subTest(joint=joint):
                self.write({"asset": {"version": "2.0"}, "nodes": [{}], "skins": [{"joints": [joint]}]})
                result = inventory(self.root)["models"][0]
                self.assertEqual(result["status"], "error")
                self.assertIn("joint index", result["error"])

    def test_corrupt_container_and_json(self):
        valid = glb({"asset": {"version": "2.0"}})
        for raw in (b"", valid[:-1], valid + b"extra", valid[:20] + b"x" * (len(valid) - 20),
                    valid[:12] + struct.pack("<I", 0xFFFFFFFC) + valid[16:]):
            with self.subTest(raw=raw):
                (self.root / "bad.glb").write_bytes(raw)
                self.assertEqual(inventory(self.root)["models"][0]["status"], "error")

    def test_cli_keeps_partial_report_and_fails_on_empty_or_bad_input(self):
        output = self.root / "report.json"
        command = [sys.executable, str(Path(__file__).with_name("inventory.py")), str(self.root), "--output", str(output)]
        self.assertEqual(subprocess.run(command, check=False).returncode, 1)
        self.write({"asset": {"version": "2.0"}})
        self.assertEqual(subprocess.run(command, check=False).returncode, 0)
        first = output.read_bytes()
        self.assertEqual(subprocess.run(command, check=False).returncode, 0)
        self.assertEqual(first, output.read_bytes())
        (self.root / "broken.glb").write_bytes(b"bad")
        self.assertEqual(subprocess.run(command, check=False).returncode, 1)
        report = json.loads(output.read_text())
        self.assertEqual([m["status"] for m in report["models"]], ["error", "inspected"])

    def test_cli_cannot_overwrite_input_via_output_alias(self):
        source = self.write({"asset": {"version": "2.0"}})
        before = source.read_bytes()
        alias = self.root / "alias.json"
        alias.symlink_to(source)
        for output in (source, alias):
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("inventory.py")),
                                     str(self.root), "--output", str(output)], capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(source.read_bytes(), before)

    def test_missing_position_preserves_rig_and_clips(self):
        doc = {"asset": {"version": "2.0"}, "nodes": [{"name": "hips"}],
               "skins": [{"joints": [0]}], "accessors": [{"count": 3}],
               "meshes": [{"primitives": [{"attributes": {"NORMAL": 0}}]}],
               "animations": [{"name": "idle", "channels": [{"sampler": 0, "target": {"node": 0, "path": "rotation"}}],
                               "samplers": [{"input": 0, "output": 0}]}]}
        result = inspect_glb(self.write(doc))
        self.assertIsNone(result["meshes"][0]["primitives"][0]["vertex_count"])
        self.assertEqual(result["skins"][0]["joint_names"], ["hips"])
        self.assertEqual(result["animations"][0]["name"], "idle")
        del doc["meshes"][0]["primitives"][0]["attributes"]
        with self.assertRaisesRegex(ValueError, "mesh 0 primitive 0: missing required 'attributes'"):
            inspect_glb(self.write(doc))

    def test_deep_json_preserves_partial_cli_report(self):
        self.write({"asset": {"version": "2.0"}})
        payload = b"[" * 10000 + b"0" + b"]" * 10000
        payload += b" " * (-len(payload) % 4)
        (self.root / "deep.glb").write_bytes(
            struct.pack("<5I", 0x46546C67, 2, 20 + len(payload), len(payload), 0x4E4F534A) + payload)
        output = self.root / "report.json"
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("inventory.py")),
                                 str(self.root), "--output", str(output)], capture_output=True)
        self.assertEqual(result.returncode, 1)
        models = json.loads(output.read_text())["models"]
        self.assertEqual([m["status"] for m in models], ["error", "inspected"])
        self.assertIn("recursion", models[0]["error"])
        self.assertNotIn(b"Traceback", result.stderr)

    def test_mixed_case_discovery_and_single_cli_walk(self):
        source = self.write({"asset": {"version": "2.0"}})
        source.rename(self.root / "MODEL.GLB")
        (self.root / "nested").mkdir()
        (self.root / "nested/other.GlB").write_bytes(glb({"asset": {"version": "2.0"}}))
        output = self.root / "report.json"
        output.write_text("old")
        with patch("inventory.discover_glbs", wraps=discover_glbs) as discover:
            with patch.object(sys, "argv", ["inventory.py", str(self.root), "--output", str(output)]):
                self.assertEqual(main(), 0)
            discover.assert_called_once_with(self.root)
        self.assertEqual([m["path"] for m in json.loads(output.read_text())["models"]],
                         ["MODEL.GLB", "nested/other.GlB"])

    def test_node_summary_excludes_extras_and_checks_references(self):
        doc = {"asset": {"version": "2.0"}, "nodes": [
            {"name": "root", "translation": [0, 1, 0], "children": [1],
             "extras": {"large": "x" * 1000}, "extensions": {"vendor": {}}}, {}]}
        self.assertEqual(inspect_glb(self.write(doc))["nodes"],
                         [{"name": "root", "translation": [0, 1, 0], "children": [1]}, {}])
        for field in ("children", "mesh", "camera"):
            for bad in (-1, 2, True):
                with self.subTest(field=field, bad=bad):
                    doc["nodes"] = [{field: [bad] if field == "children" else bad}]
                    with self.assertRaisesRegex(ValueError, "node 0"):
                        inspect_glb(self.write(doc))

    def test_dangling_output_and_hardlink_do_not_modify_sources(self):
        source = self.write({"asset": {"version": "2.0"}})
        source = source.rename(self.root / "source.GLB")
        before = source.read_bytes()
        hardlink = self.root / "hardlink.json"
        hardlink.hardlink_to(source)
        dangling = self.root / "dangling.json"
        target = self.root / "not-created.glb"
        dangling.symlink_to(target)
        for output in (hardlink, dangling):
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("inventory.py")),
                                     str(self.root), "--output", str(output)], capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(source.read_bytes(), before)
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
