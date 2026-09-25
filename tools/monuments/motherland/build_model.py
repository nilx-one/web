# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Motherland monument, futuristic study — editable procedural sculpture.

Not a photogrammetric scan and not a claim of exact likeness: a low-poly,
chrome-and-neon reinterpretation of Kyiv's Motherland Monument, built the same
way the local studies are (`tools/avatars/*/build_model.py`) — authored in
metres, Z-up, exported Y-up — but with no skeleton: the figure never moves,
so it carries no joints, no weights, no animation clips. A single static
mesh is the whole of the export.

Run: python build_model.py --output DIRECTORY
Dependencies: numpy, scipy, trimesh.
"""
from pathlib import Path
import argparse

import numpy as np
from scipy.interpolate import PchipInterpolator
import trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

parser = argparse.ArgumentParser()
parser.add_argument("--output", default="../motherland-3d-output")
args = parser.parse_args()
OUT = Path(args.output).resolve()
OUT.mkdir(parents=True, exist_ok=True)

PARTS = []

# Chrome body, cyan-emissive trim — the "futuristic" read is the material,
# not a different silhouette. emissiveFactor pushes the trim past 1.0 so a
# renderer with bloom blooms it; a renderer without bloom still shows it as a
# flat lit cyan, never dark.
PALETTE = {
    "chrome": ("#c9d2d6", 0.18, 0.92, None),
    "chrome_dark": ("#8b959b", 0.24, 0.90, None),
    "pedestal": ("#5b6266", 0.62, 0.35, None),
    "neon": ("#5be7ff", 0.10, 0.05, (0.35, 4.4, 5.4)),
    "neon_warm": ("#ffe9a8", 0.10, 0.05, (5.4, 4.2, 1.6)),
}


def rgb(hex_color):
    return [int(hex_color[i : i + 2], 16) for i in (1, 3, 5)]


MATERIALS = {
    name: PBRMaterial(
        name=name,
        baseColorFactor=rgb(color) + [255],
        roughnessFactor=roughness,
        metallicFactor=metallic,
        emissiveFactor=list(emissive) if emissive is not None else None,
        doubleSided=True,
    )
    for name, (color, roughness, metallic, emissive) in PALETTE.items()
}


def add(name, verts, faces, mat, group="body"):
    mesh = trimesh.Trimesh(
        vertices=np.asarray(verts), faces=np.asarray(faces), process=True
    )
    mesh.fix_normals()
    mesh.visual = TextureVisuals(material=MATERIALS[mat])
    mesh.metadata = {"name": name, "group": group, "material": mat}
    PARTS.append(mesh)
    return mesh


def grid_mesh(name, grid, mat, wrap=False, group="body"):
    g = np.asarray(grid)
    n, m = g.shape[:2]
    faces = []
    for i in range(n - 1):
        for j in range(m if wrap else m - 1):
            k = (j + 1) % m
            a, b, c, d = i * m + j, i * m + k, (i + 1) * m + k, (i + 1) * m + j
            faces.extend([[a, b, c], [a, c, d]])
    return add(name, g.reshape(-1, 3), faces, mat, group)


def loft(name, sections, mat, rings=48, sides=48, group="body", gap=None):
    # sections: z, radius_x, radius_y, center_x, center_y
    sec = np.array(sections, dtype=float)
    z = np.linspace(sec[0, 0], sec[-1, 0], rings)
    vals = PchipInterpolator(sec[:, 0], sec[:, 1:], axis=0)(z)
    grid = []
    for zz, (rx, ry, cx, cy) in zip(z, vals):
        alpha = 0 if gap is None else gap(zz)
        theta = np.linspace(alpha, 2 * np.pi - alpha, sides, endpoint=gap is not None)
        grid.append(
            [[cx + rx * np.sin(a), cy - ry * np.cos(a), zz] for a in theta]
        )
    return grid_mesh(name, grid, mat, gap is None, group)


def interp_path(points, n=40):
    p = np.asarray(points, float)
    t = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    t /= t[-1]
    return PchipInterpolator(t, p, axis=0)(np.linspace(0, 1, n))


def tube(name, points, radii, mat, n=40, sides=16, group="body"):
    path = interp_path(points, n)
    tangent = np.gradient(path, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    rr = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(radii)), radii)
    grid = []
    for p, t, r in zip(path, tangent, rr):
        v = np.cross(t, [0, 1, 0])
        if np.linalg.norm(v) < 0.01:
            v = np.cross(t, [1, 0, 0])
        v /= np.linalg.norm(v)
        w = np.cross(t, v)
        grid.append(
            [p + r * (np.cos(a) * v + np.sin(a) * w) for a in np.linspace(0, 2 * np.pi, sides, endpoint=False)]
        )
    return grid_mesh(name, grid, mat, True, group)


def box(name, center, size, mat, group="body"):
    cx, cy, cz = center
    sx, sy, sz = (dim / 2 for dim in size)
    verts = [
        [cx + x * sx, cy + y * sy, cz + z * sz]
        for z in (-1, 1)
        for y in (-1, 1)
        for x in (-1, 1)
    ]
    faces = [
        [0, 1, 3], [0, 3, 2],  # bottom
        [4, 6, 7], [4, 7, 5],  # top
        [0, 4, 5], [0, 5, 1],  # -y
        [2, 3, 7], [2, 7, 6],  # +y
        [0, 2, 6], [0, 6, 4],  # -x
        [1, 5, 7], [1, 7, 3],  # +x
    ]
    return add(name, verts, faces, mat, group)


# ---------------------------------------------------------------- pedestal
# The real monument's pylon reads as a stepped chrome plinth here rather than
# the museum building underneath it; the figure is what carries the design.
PEDESTAL_HEIGHT = 36.0
loft(
    "pedestal",
    [
        (0.0, 21.0, 21.0, 0, 0),
        (2.5, 21.0, 21.0, 0, 0),
        (2.501, 17.5, 17.5, 0, 0),
        (PEDESTAL_HEIGHT - 3.0, 15.0, 15.0, 0, 0),
        (PEDESTAL_HEIGHT - 2.999, 12.5, 12.5, 0, 0),
        (PEDESTAL_HEIGHT, 12.5, 12.5, 0, 0),
    ],
    "pedestal",
    rings=8,
    sides=4,
    group="pedestal",
)
# A single glowing seam at the plinth's shoulder, standing in for the ring of
# light a night render would put at the museum's roofline.
tube(
    "pedestal_ring",
    [
        [15.0 * np.sin(a), -15.0 * np.cos(a), PEDESTAL_HEIGHT - 3.0]
        for a in np.linspace(0, 2 * np.pi, 5)
    ],
    [0.12],
    "neon",
)

BASE = PEDESTAL_HEIGHT  # figure stands on top of the pedestal

# ---------------------------------------------------------------- figure
# Torso: a straight robed column, footprint scaled against the real statue's
# ~62 m crown-to-sword-tip height so the whole monument masses ~102 m, the
# height the current museum-and-statue landmark is drawn at.
loft(
    "robe",
    [
        (BASE + 0.0, 9.0, 7.0, 0, 0),
        (BASE + 4.0, 8.2, 6.4, 0, 0.3),
        (BASE + 18.0, 7.0, 5.6, 0, 0.6),
        (BASE + 30.0, 6.0, 5.0, 0, 0.4),
        (BASE + 40.0, 5.4, 4.6, 0, 0),
        (BASE + 46.0, 4.6, 4.0, 0, -0.2),
    ],
    "chrome",
    rings=40,
    sides=48,
    group="torso",
)
loft(
    "torso_upper",
    [
        (BASE + 46.001, 4.6, 4.0, 0, -0.2),
        (BASE + 50.0, 3.8, 3.4, 0, -0.3),
        (BASE + 54.0, 2.6, 2.6, 0, -0.2),
    ],
    "chrome",
    rings=16,
    sides=48,
    group="torso",
)
loft(
    "neck",
    [(BASE + 54.0, 1.3, 1.3, 0, -0.2), (BASE + 56.0, 1.3, 1.3, 0, -0.2)],
    "chrome_dark",
    rings=4,
    sides=32,
    group="head",
)
mesh = trimesh.creation.uv_sphere(count=[24, 32])
mesh.vertices *= [1.7, 1.9, 2.1]
mesh.vertices += [0, -0.1, BASE + 58.5]
add("head", mesh.vertices, mesh.faces, "chrome_dark", "head")

# Left arm: bent at the elbow, holding the shield aloft — mirrors the
# monument's raised-shield pose without a hand rig; the shield is welded to
# the forearm's end.
tube(
    "left_arm",
    [
        [-4.0, -0.5, BASE + 48.0],
        [-8.5, 1.5, BASE + 54.0],
        [-9.0, 5.0, BASE + 59.0],
        [-8.0, 8.5, BASE + 63.0],
    ],
    [1.5, 1.3, 1.1, 0.9],
    "chrome",
    group="arm",
)
shield_faces = []
shield_pts = np.array(
    [
        [0, 0, 8.5],
        [-6.5, 0, 5.2],
        [-4.5, 0, -5.0],
        [0, 0, -8.0],
        [4.5, 0, -5.0],
        [6.5, 0, 5.2],
    ]
)
center = shield_pts.mean(axis=0)
front = np.vstack([center, shield_pts])
back = front + [0, 0.8, 0]
n = len(shield_pts)
for i in range(n):
    a, b = i + 1, (i + 1) % n + 1
    shield_faces.extend(
        [[0, a, b], [n + 1, n + 1 + b, n + 1 + a], [a, n + 1 + a, n + 1 + b], [a, n + 1 + b, b]]
    )
shield_verts = np.vstack([front, back]) + [-8.0, 8.9, BASE + 63.0]
add("shield", shield_verts, shield_faces, "chrome_dark", "shield")
# Trident emblem: three narrow tubes standing proud of the shield face —
# the shield the monument has carried since its 2023 re-crest.
for offset, height in ((-1.4, 3.4), (0.0, 4.2), (1.4, 3.4)):
    tube(
        "trident_prong",
        [
            [-8.0 + offset, 9.5, BASE + 60.0],
            [-8.0 + offset, 9.5, BASE + 60.0 + height],
        ],
        [0.28, 0.22],
        "neon",
        group="shield",
    )
tube(
    "trident_crossbar",
    [[-8.0 - 1.7, 9.5, BASE + 61.4], [-8.0 + 1.7, 9.5, BASE + 61.4]],
    [0.24, 0.24],
    "neon",
    group="shield",
)

# Right arm: raised straight overhead, the sword its silhouette is known for.
tube(
    "right_arm",
    [
        [4.0, -0.5, BASE + 48.0],
        [7.5, 2.0, BASE + 55.0],
        [7.0, 4.5, BASE + 62.0],
        [6.0, 5.5, BASE + 68.0],
    ],
    [1.5, 1.3, 1.1, 0.9],
    "chrome",
    group="arm",
)
tube(
    "sword_hilt",
    [[6.0, 5.5, BASE + 68.0], [6.0, 5.5, BASE + 70.0]],
    [1.0, 0.9],
    "chrome_dark",
    group="sword",
)
tube(
    "sword_guard",
    [[3.5, 5.5, BASE + 70.3], [8.5, 5.5, BASE + 70.3]],
    [0.4, 0.4],
    "chrome_dark",
    group="sword",
)
tube(
    "sword_blade",
    [[6.0, 5.5, BASE + 70.6], [6.0, 5.5, BASE + 102.0]],
    [0.9, 0.15],
    "chrome",
    group="sword",
)
# The blade's edge is the one line of light on the whole figure — the read
# this study is built around: everything else is reflective, only the weapon
# and the shield's crest actually emit.
tube(
    "sword_edge",
    [[6.0, 5.55, BASE + 70.6], [6.0, 5.55, BASE + 102.2]],
    [0.05, 0.05],
    "neon",
    group="sword",
)

# Everything above the pedestal was authored at a comfortable working scale;
# squeeze it vertically (x/y untouched, so silhouettes and cross-sections
# keep their shape) so the sword tip lands at the real monument's documented
# total height rather than the author's own scratch numbers.
FIGURE_TOP_METERS = 102.0
authored_top = max(mesh.vertices[:, 2].max() for mesh in PARTS)
figure_scale = (FIGURE_TOP_METERS - BASE) / (authored_top - BASE)
for mesh in PARTS:
    vertices = mesh.vertices.copy()
    above_base = vertices[:, 2] > BASE
    vertices[above_base, 2] = BASE + (vertices[above_base, 2] - BASE) * figure_scale
    mesh.vertices = vertices

scene = trimesh.Scene(PARTS)
out_path = OUT / "motherland.glb"
out_path.write_bytes(trimesh.exchange.gltf.export_glb(scene))
print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")
