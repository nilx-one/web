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


def render(path, azimuth):
    doc, accessor = read_glb(path)
    colour = np.full((H, W, 3), BG, dtype=np.float64)
    depth = np.full((H, W), -np.inf)

    triangles, tint = [], []
    for mesh in doc["meshes"]:
        for primitive in mesh["primitives"]:
            position = accessor(primitive["attributes"]["POSITION"]).astype(np.float64)
            normal = accessor(primitive["attributes"]["NORMAL"]).astype(np.float64)
            index = accessor(primitive["indices"]).reshape(-1, 3).astype(np.int64)
            base = doc["materials"][primitive["material"]]["pbrMetallicRoughness"]["baseColorFactor"][:3]
            triangles.append((position, normal, index))
            tint.append(np.array(base, dtype=np.float64))

    every = np.vstack([p for p, _, _ in triangles])
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

    for (position, normal, index), base in zip(triangles, tint):
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
    return colour.astype(np.uint8)


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
# The published thumbnails a client shows while a person chooses a body. They
# are generated from the same studies, so a picker can never offer a figure the
# world would not draw.
parser.add_argument("--thumbnails", help="write one front-view PNG per study here")
arguments = parser.parse_args()

if arguments.thumbnails is not None:
    directory = Path(arguments.thumbnails)
    directory.mkdir(parents=True, exist_ok=True)
    for model in arguments.models:
        panel = render(ASSETS / f"{model}-study.glb", 0)
        # Halve the sheet resolution: a picker card never needs more.
        thumbnail = panel.reshape(H // 2, 2, W // 2, 2, 3).mean(axis=(1, 3))
        path = directory / f"{model}-study.png"
        write_png(path, thumbnail.round().astype(np.uint8))
        print("wrote", path, flush=True)

if arguments.output is not None:
    panels = []
    for model in arguments.models:
        for azimuth in arguments.angles:
            panels.append(render(ASSETS / f"{model}-study.glb", azimuth))
        print("rendered", model, flush=True)

    sheet = np.concatenate(panels, axis=1)
    write_png(Path(arguments.output), sheet)
    print("wrote", arguments.output, sheet.shape)
