# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Offline preview sheet of the published avatar studies.

Run: python tools/avatars/preview.py OUTPUT.png [--models sky dasha kai]

Reads the exported GLBs, rasterises one orthographic view per study per angle
with a z-buffer and per-material flat shading, and writes a single PNG. Numpy is
the only dependency, and nothing here runs at runtime: this is a look at the
geometry someone can take without a device or a scene editor. It is not the
runtime renderer and not a substitute for inspecting a study in Blender.
"""
import argparse
import json
import struct
import zlib
from pathlib import Path

import numpy as np

ASSETS = Path(__file__).resolve().parents[2] / "deploy/web/avatars/0.1.0"
W, H = 420, 900
BG = np.array([248, 247, 244], dtype=np.float64)


def read_glb(path):
    raw = path.read_bytes()
    magic, version, length, json_length, kind = struct.unpack_from("<5I", raw)
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


def render(path, azimuth, visible=None, focus=None):
    """Rasterise one study. `visible` names the mesh nodes to draw.

    `focus` names the nodes a caller wants framed, and is answered with the
    screen box they occupy. A wardrobe still that showed the whole body would
    be the same picture for every pair of shoes; the box is what lets the
    still be of the item.

    A modular character carries every wearable it publishes in one asset, so a
    look at it is a look at one resolved outfit rather than at all of them at
    once. Framing is measured from the whole character either way, so two
    outfits of the same body are photographed from the same distance.
    """
    doc, accessor = read_glb(path)
    colour = np.full((H, W, 3), BG, dtype=np.float64)
    depth = np.full((H, W), -np.inf)

    triangles, tint = [], []
    bounds, focused = [], []
    for mesh in doc["meshes"]:
        for primitive in mesh["primitives"]:
            position = accessor(primitive["attributes"]["POSITION"]).astype(np.float64)
            normal = accessor(primitive["attributes"]["NORMAL"]).astype(np.float64)
            index = accessor(primitive["indices"]).reshape(-1, 3).astype(np.int64)
            base = doc["materials"][primitive["material"]]["pbrMetallicRoughness"]["baseColorFactor"][:3]
            bounds.append(position)
            if focus is not None and mesh.get("name") in focus:
                focused.append(position)
            if visible is not None and mesh.get("name") not in visible:
                continue
            triangles.append((position, normal, index))
            tint.append(np.array(base, dtype=np.float64))
    drawn = triangles

    every = np.vstack(bounds)
    low, high = every.min(axis=0), every.max(axis=0)
    height = high[1] - low[1]
    scale = (H * 0.92) / height
    centre = (low + high) / 2

    angle = np.radians(azimuth)
    rotation = np.array([[np.cos(angle), 0, np.sin(angle)],
                         [0, 1, 0],
                         [-np.sin(angle), 0, np.cos(angle)]])
    light = np.array([0.30, 0.55, 0.78])
    light /= np.linalg.norm(light)

    for (position, normal, index), base in zip(drawn, tint):
        view = (position - centre) @ rotation.T
        screen = np.empty_like(view)
        screen[:, 0] = W / 2 + view[:, 0] * scale
        screen[:, 1] = H / 2 - view[:, 1] * scale
        screen[:, 2] = view[:, 2]
        facing = (normal @ rotation.T)
        shade = np.clip(facing @ light, 0, 1) * 0.75 + 0.25

        tri = screen[index]
        face_shade = shade[index].mean(axis=1)
        # Cull triangles whose projected area is degenerate or back-facing.
        area = ((tri[:, 1, 0] - tri[:, 0, 0]) * (tri[:, 2, 1] - tri[:, 0, 1])
                - (tri[:, 2, 0] - tri[:, 0, 0]) * (tri[:, 1, 1] - tri[:, 0, 1]))
        keep = np.abs(area) > 1e-9
        tri, face_shade, area = tri[keep], face_shade[keep], area[keep]

        for corner, lit, size in zip(tri, face_shade, area):
            x0 = max(int(np.floor(corner[:, 0].min())), 0)
            x1 = min(int(np.ceil(corner[:, 0].max())) + 1, W)
            y0 = max(int(np.floor(corner[:, 1].min())), 0)
            y1 = min(int(np.ceil(corner[:, 1].max())) + 1, H)
            if x0 >= x1 or y0 >= y1:
                continue
            xs = np.arange(x0, x1) + 0.5
            ys = np.arange(y0, y1) + 0.5
            gx, gy = np.meshgrid(xs, ys)
            w0 = ((corner[1, 0] - corner[0, 0]) * (gy - corner[0, 1])
                  - (gx - corner[0, 0]) * (corner[1, 1] - corner[0, 1])) / size
            w1 = ((corner[2, 0] - corner[1, 0]) * (gy - corner[1, 1])
                  - (gx - corner[1, 0]) * (corner[2, 1] - corner[1, 1])) / size
            w2 = 1 - w0 - w1
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not inside.any():
                continue
            z = w1 * corner[0, 2] + w2 * corner[1, 2] + w0 * corner[2, 2]
            window = depth[y0:y1, x0:x1]
            nearer = inside & (z > window)
            if not nearer.any():
                continue
            window[nearer] = z[nearer]
            colour[y0:y1, x0:x1][nearer] = np.clip(base * lit * 255, 0, 255)
    box = None
    if focused:
        view = (np.vstack(focused) - centre) @ rotation.T
        xs = W / 2 + view[:, 0] * scale
        ys = H / 2 - view[:, 1] * scale
        box = (xs.min(), ys.min(), xs.max(), ys.max())
    return colour.astype(np.uint8), box


def write_png(path, image):
    height, width, _ = image.shape
    raw = b"".join(b"\0" + image[row].tobytes() for row in range(height))

    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b""))


parser = argparse.ArgumentParser()
parser.add_argument("output", nargs="?")
parser.add_argument("--models", nargs="+", default=["sky", "dasha", "kai"])
parser.add_argument("--angles", nargs="+", type=float, default=[0, -35])
parser.add_argument("--asset-dir", type=Path, default=ASSETS)
# The published thumbnails a client shows while a person chooses a body. They
# are generated from the same studies, so a picker can never offer a figure the
# world would not draw.
parser.add_argument("--thumbnails", help="write one front-view PNG per study here")
# A modular character's wardrobe is shown item by item, so each item gets a
# still of that item on this body — never a swatch standing in for cloth
# nobody rendered.
parser.add_argument("--wardrobe", action="store_true",
                    help="also write one still per wardrobe item of a modular study")
arguments = parser.parse_args()
ASSETS = arguments.asset_dir


THUMBNAIL = 240


def halve(panel):
    """A picker card never needs the sheet's resolution."""
    return panel.reshape(H // 2, 2, W // 2, 2, 3).mean(axis=(1, 3)).round().astype(np.uint8)


def crop_square(panel, box, size=THUMBNAIL):
    """A square still of what a box encloses, with room around it to read.

    Nearest-neighbour resampling keeps this dependency-free and exactly
    reproducible; a picker card is a look at cloth, not a print.
    """
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = max((x1 - x0), (y1 - y0)) * 0.72
    half = min(max(half, 60.0), min(W, H) / 2)
    cx = min(max(cx, half), W - half)
    cy = min(max(cy, half), H - half)
    left, top = int(round(cx - half)), int(round(cy - half))
    span = max(int(round(half * 2)), 1)
    window = panel[top:top + span, left:left + span]
    rows = (np.arange(size) * window.shape[0] // size).clip(0, window.shape[0] - 1)
    columns = (np.arange(size) * window.shape[1] // size).clip(0, window.shape[1] - 1)
    return window[rows][:, columns]


def read_manifest(model):
    path = ASSETS / f"{model}-study.manifest.json"
    return json.loads(path.read_text()) if path.exists() else None


def outfit_nodes(manifest, worn):
    """The mesh nodes one resolved outfit draws.

    A region is drawn unless something worn encloses it; the body's own
    always-visible regions are never hidden by anything. This is the same rule
    the runtime resolves, kept here so a still and the world agree.
    """
    hides = set()
    for item in manifest["wardrobe"]:
        if item["id"] in worn:
            hides.update(item["hides"])
    nodes = {"body:" + region for region in manifest["always_visible"]}
    nodes.update("body:" + region for region in manifest["body_regions"]
                 if region not in hides)
    nodes.update("wear:" + item for item in worn)
    return nodes


def default_worn(manifest):
    worn = []
    for value in manifest["default_outfit"].values():
        worn.extend([value] if isinstance(value, str) else value)
    return worn


def item_slug(item_id):
    return item_id.replace("/", "-")


if arguments.thumbnails is not None:
    directory = Path(arguments.thumbnails)
    directory.mkdir(parents=True, exist_ok=True)
    for model in arguments.models:
        asset = ASSETS / f"{model}-study.glb"
        manifest = read_manifest(model)
        modular = manifest is not None and manifest.get("modular")
        worn = default_worn(manifest) if modular else []
        visible = outfit_nodes(manifest, worn) if modular else None
        path = directory / f"{model}-study.png"
        panel, _ = render(asset, 0, visible)
        write_png(path, halve(panel))
        print("wrote", path, flush=True)
        if modular and arguments.wardrobe:
            for item in manifest["wardrobe"]:
                # Each item is shown on a body dressed the way this study is
                # published, with only its own slot replaced — so a person sees
                # the change they are actually about to make.
                # The same compatibility rule the runtime enforces: a dress is
                # the whole garment, so a still of one is never a dress drawn
                # over the separates it replaces.
                schema = {entry["slot"]: entry for entry in manifest["slots"]}
                blocked = {item["slot"], *schema[item["slot"]]["conflicts"]}
                blocked.update(other for other, entry in schema.items()
                               if item["slot"] in entry["conflicts"])
                slot_of = {other["id"]: other["slot"] for other in manifest["wardrobe"]}
                if item["slot"] == "accessories":
                    others = [entry for entry in worn if entry != item["id"]]
                else:
                    others = [entry for entry in worn if slot_of[entry] not in blocked]
                shown = others + [item["id"]]
                path = directory / f"{model}-study.{item_slug(item['id'])}.png"
                panel, box = render(asset, 0, outfit_nodes(manifest, shown),
                                    focus={"wear:" + item["id"]})
                write_png(path, crop_square(panel, box))
                print("wrote", path, flush=True)

if arguments.output is not None:
    panels = []
    for model in arguments.models:
        asset = ASSETS / f"{model}-study.glb"
        manifest = read_manifest(model)
        modular = manifest is not None and manifest.get("modular")
        outfits = ([outfit_nodes(manifest, default_worn(manifest))] if modular
                   else [None])
        if modular and arguments.wardrobe:
            outfits = [outfit_nodes(manifest, worn) for worn in [
                default_worn(manifest),
                ["hair/loose-long", "top/shell-ecru", "bottom/skirt-charcoal",
                 "shoes/sneakers-white", "accessory/earrings-silver"],
                ["hair/loose-long", "dress/shift-indigo", "shoes/loafers-black"],
                ["hair/swept-bun"],
            ]]
        for visible in outfits:
            for azimuth in arguments.angles:
                panels.append(render(asset, azimuth, visible)[0])
        print("rendered", model, flush=True)

    sheet = np.concatenate(panels, axis=1)
    write_png(Path(arguments.output), sheet)
    print("wrote", arguments.output, sheet.shape)
