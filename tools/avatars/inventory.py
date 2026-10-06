# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Read-only GLB metadata inventory, not a glTF or deformation validator."""
import argparse
import hashlib
import json
from pathlib import Path
import struct


def inspect_glb(path):
    raw = path.read_bytes()
    if len(raw) < 20:
        raise ValueError("truncated GLB header")
    magic, version, length = struct.unpack_from("<III", raw)
    if (magic, version, length) != (0x46546C67, 2, len(raw)):
        raise ValueError("invalid GLB magic, version or length")
    chunks = []
    offset = 12
    while offset < len(raw):
        if offset + 8 > len(raw):
            raise ValueError("truncated chunk header")
        size, kind = struct.unpack_from("<II", raw, offset)
        offset += 8
        if size % 4 or offset + size > len(raw):
            raise ValueError("invalid chunk length")
        chunks.append((kind, raw[offset:offset + size]))
        offset += size
    if not chunks or chunks[0][0] != 0x4E4F534A:
        raise ValueError("first chunk must be JSON")
    if sum(kind == 0x4E4F534A for kind, _ in chunks) != 1:
        raise ValueError("duplicate JSON chunk")
    doc = json.loads(chunks[0][1])
    if doc.get("asset", {}).get("version") != "2.0":
        raise ValueError("expected glTF 2.0")
    nodes = doc.get("nodes", [])
    accessors = doc.get("accessors", [])

    def at(items, index, label):
        if type(index) is not int or not 0 <= index < len(items):
            raise ValueError("invalid " + label + " index")
        return items[index]

    skins = []
    for skin in doc.get("skins", []):
        joints = skin["joints"]
        joint_names = [at(nodes, j, "joint").get("name") for j in joints]
        inverse = skin.get("inverseBindMatrices")
        descriptor = at(accessors, inverse, "inverse bind accessor") if inverse is not None else None
        skins.append({"name": skin.get("name"), "joints": joints,
                      "joint_names": joint_names,
                      "inverse_bind_matrices": descriptor})
    meshes = []
    for mesh in doc.get("meshes", []):
        primitives = []
        for primitive in mesh["primitives"]:
            attrs = primitive["attributes"]
            for index in attrs.values():
                at(accessors, index, "attribute accessor")
            primitives.append({"attributes": sorted(attrs),
                               "vertex_count": at(accessors, attrs["POSITION"], "position accessor")["count"],
                               "has_skin_attributes": "JOINTS_0" in attrs and "WEIGHTS_0" in attrs,
                               "morph_target_count": len(primitive.get("targets", []))})
        meshes.append({"name": mesh.get("name"), "primitives": primitives})
    bindings = []
    for index, node in enumerate(nodes):
        if "skin" in node:
            at(skins, node["skin"], "skin")
            at(meshes, node["mesh"], "mesh")
            bindings.append({"node": index, "mesh": node["mesh"], "skin": node["skin"]})
    animations = []
    for clip in doc.get("animations", []):
        for channel in clip["channels"]:
            sampler = at(clip["samplers"], channel["sampler"], "animation sampler")
            at(accessors, sampler["input"], "animation input")
            at(accessors, sampler["output"], "animation output")
            if "node" in channel["target"]:
                at(nodes, channel["target"]["node"], "animation target")
        animations.append({"name": clip.get("name"),
                           "channel_count": len(clip["channels"]),
                           "target_paths": sorted({c["target"]["path"] for c in clip["channels"]})})
    return {"status": "inspected", "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw), "generator": doc["asset"].get("generator"),
            "skins": skins, "skin_bindings": bindings, "meshes": meshes,
            "animations": animations, "nodes": nodes,
            "material_count": len(doc.get("materials", [])),
            "texture_count": len(doc.get("textures", [])),
            "extensions_required": doc.get("extensionsRequired", [])}


def inventory(root):
    paths = sorted(root.rglob("*.glb"))
    models = []
    for path in paths:
        try:
            model = inspect_glb(path)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            model = {"status": "error", "error": str(error)}
        models.append({"path": path.relative_to(root).as_posix(), **model})
    return {"schema_version": 1, "inspection": "GLB container and JSON metadata only",
            "limitations": ["Accessor payloads and external resources are not decoded.",
                            "No humanoid, donor, deformation or production readiness is inferred."],
            "models": models}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("asset_dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.suffix.lower() != ".json":
        parser.error("output must be a .json report, never a source GLB")
    if args.output.exists() and any(args.output.samefile(path) for path in args.asset_dir.rglob("*.glb")):
        parser.error("output must not alias a source GLB")
    report = inventory(args.asset_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0 if report["models"] and all(m["status"] == "inspected" for m in report["models"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
