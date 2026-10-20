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
# not a different silhouette. The chrome is a true mirror: the layer gives it
# the reference render's sky to reflect (monument-layer.ts, MONUMENT_SKY). emissiveFactor pushes the trim past 1.0 so a
# renderer with bloom blooms it; a renderer without bloom still shows it as a
# flat lit cyan, never dark.
PALETTE = {
    "chrome": ("#e6eef3", 0.16, 0.92, None),
    "chrome_dark": ("#a9bac5", 0.22, 0.88, None),
    "pedestal": ("#aab5ba", 0.42, 0.40, None),
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


def loft(name, sections, mat, rings=48, sides=48, group="body", gap=None, fold=None):
    # sections: z, radius_x, radius_y, center_x, center_y
    # fold(z, theta): radial swell at that height and angle, 0 for none.
    sec = np.array(sections, dtype=float)
    z = np.linspace(sec[0, 0], sec[-1, 0], rings)
    vals = PchipInterpolator(sec[:, 0], sec[:, 1:], axis=0)(z)
    grid = []
    for zz, (rx, ry, cx, cy) in zip(z, vals):
        alpha = 0 if gap is None else gap(zz)
        theta = np.linspace(alpha, 2 * np.pi - alpha, sides, endpoint=gap is not None)
        swell = [1.0 + (0 if fold is None else fold(zz, a)) for a in theta]
        grid.append(
            [[cx + k * rx * np.sin(a), cy - k * ry * np.cos(a), zz] for a, k in zip(theta, swell)]
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


def ellipsoid(name, center, radii, mat, group="body"):
    mesh = trimesh.creation.uv_sphere(count=[20, 28])
    return add(name, mesh.vertices * radii + center, mesh.faces, mat, group)


def ring(name, center, radius, z, mat, thickness=0.14, group="body"):
    theta = np.linspace(0, 2 * np.pi, 97)[:-1]
    points = [[center[0] + radius * np.sin(a), center[1] - radius * np.cos(a), z] for a in theta]
    grid = []
    for p, a in zip(points, theta):
        out = np.array([np.sin(a), -np.cos(a), 0.0])
        grid.append(
            [
                np.array(p) + thickness * (np.cos(b) * out + np.sin(b) * np.array([0, 0, 1.0]))
                for b in np.linspace(0, 2 * np.pi, 10, endpoint=False)
            ]
        )
    # Closed both ways: around the tube and around the loop.
    g = np.asarray(grid)
    n, m = g.shape[:2]
    faces = []
    for i in range(n):
        for j in range(m):
            a, b = i * m + j, i * m + (j + 1) % m
            c, d = ((i + 1) % n) * m + (j + 1) % m, ((i + 1) % n) * m + j
            faces.extend([[a, b, c], [a, c, d]])
    return add(name, g.reshape(-1, 3), faces, mat, group)


# ---------------------------------------------------------------- pedestal
# The real monument stands on the museum's drum, a 40 m pylon; here it is a
# round chrome plinth banded with light, the way the reference render lights
# it. Its footprint covers the drum and the buttresses the basemap carries
# there, which the renderer cuts out of its own extrusion in favour of this.
PEDESTAL_HEIGHT = 40.0
PEDESTAL_SHOULDER = PEDESTAL_HEIGHT - 3.0


def pedestal_radius(z):
    return 17.5 - 2.5 * (z - 3.0) / (PEDESTAL_SHOULDER - 3.0)


loft(
    "pedestal",
    [
        (0.0, 20.0, 20.0, 0, 0),
        (3.0, 20.0, 20.0, 0, 0),
        (3.001, 17.5, 17.5, 0, 0),
        (PEDESTAL_SHOULDER, 15.0, 15.0, 0, 0),
        (PEDESTAL_SHOULDER + 0.001, 13.0, 13.0, 0, 0),
        (PEDESTAL_HEIGHT, 13.0, 13.0, 0, 0),
    ],
    "pedestal",
    rings=12,
    sides=64,
    group="pedestal",
)
ring("pedestal_foot_ring", (0, 0), 17.55, 3.1, "neon", group="pedestal")
ring("pedestal_shoulder_ring", (0, 0), 15.05, PEDESTAL_SHOULDER, "neon", group="pedestal")
ring("pedestal_crown_ring", (0, 0), 13.05, PEDESTAL_HEIGHT - 0.1, "neon", group="pedestal")
# Vertical seams of light up the drum, as the reference's pylon is ribbed.
for k in range(16):
    a = 2 * np.pi * (k + 0.5) / 16
    tube(
        "pedestal_seam",
        [
            [(pedestal_radius(z) + 0.06) * np.sin(a), -(pedestal_radius(z) + 0.06) * np.cos(a), z]
            for z in (4.0, 20.0, PEDESTAL_SHOULDER - 1.0)
        ],
        [0.09, 0.09],
        "neon",
        n=6,
        sides=6,
        group="pedestal",
    )

BASE = PEDESTAL_HEIGHT  # figure stands on top of the pedestal

# ---------------------------------------------------------------- figure
# Authored at true scale: the figure's feet at the 40 m pylon top, the sword
# tip at the monument's documented 102 m, a 16 m sword and a shield about as
# tall as the figure's torso. She faces +y, her right hand on +x: sword
# raised straight up in the right hand, shield held high in the left.


def robe_fold(z, a):
    # Deep folds at the hem fading out by the bust, plus the broad sweep of
    # drapery that gives the statue its stepped, fluted silhouette.
    depth = 0.07 * float(np.clip((68.0 - z) / 26.0, 0.0, 1.0))
    return depth * np.cos(14 * a) + 0.02 * depth / 0.07 * np.cos(5 * a + 0.6)


loft(
    "robe",
    [
        (BASE + 0.0, 8.8, 7.4, 0, 0),
        (BASE + 1.5, 8.5, 7.1, 0, 0.1),
        (BASE + 7.0, 7.7, 6.3, 0, 0.2),
        (BASE + 14.0, 6.7, 5.5, 0, 0.3),
        (BASE + 20.0, 5.9, 4.8, 0, 0.3),
        (BASE + 25.0, 5.1, 4.1, 0, 0.2),
        (BASE + 28.0, 5.3, 4.0, 0, 0.3),
        (BASE + 30.5, 5.5, 3.7, 0, 0.1),
        (BASE + 32.0, 4.5, 3.1, 0, -0.1),
        (BASE + 33.2, 1.8, 1.8, 0, -0.2),
    ],
    "chrome",
    rings=56,
    sides=96,
    group="torso",
    fold=robe_fold,
)
# A sash of light where the robe gathers at the waist.
ring("waist_band", (0, 0.2), 5.12, BASE + 25.4, "neon", thickness=0.12, group="torso")
loft(
    "neck",
    [(BASE + 33.0, 1.5, 1.5, 0, -0.2), (BASE + 34.8, 1.4, 1.4, 0, -0.2)],
    "chrome_dark",
    rings=4,
    sides=32,
    group="head",
)
ellipsoid("head", (0, -0.1, BASE + 36.7), (1.9, 2.1, 2.5), "chrome", "head")
ellipsoid("hair", (0, -1.9, BASE + 37.3), (1.3, 1.1, 1.2), "chrome_dark", "head")

# Right arm: raised straight overhead, the sword its silhouette is known for.
SWORD_HAND = np.array([6.1, 0.8, BASE + 44.6])
tube(
    "right_arm",
    [
        [4.4, 0.0, BASE + 31.0],
        [5.4, 0.2, BASE + 35.5],
        [5.9, 0.5, BASE + 40.0],
        SWORD_HAND - [0, 0, 0.6],
    ],
    [1.45, 1.2, 1.0, 0.85],
    "chrome",
    group="arm",
)
ellipsoid("right_fist", SWORD_HAND, (1.05, 1.05, 1.2), "chrome", "arm")
tube(
    "sword_grip",
    [SWORD_HAND - [0, 0, 1.6], SWORD_HAND + [0, 0, 2.0]],
    [0.45, 0.45],
    "chrome_dark",
    n=4,
    group="sword",
)
tube(
    "sword_guard",
    [SWORD_HAND + [-2.1, 0, 2.2], SWORD_HAND + [2.1, 0, 2.2]],
    [0.35, 0.35],
    "chrome_dark",
    n=4,
    group="sword",
)
# The blade is the one solid of light on the figure: a diamond section that
# narrows to the tip, standing in for the reference's glowing sword.
SWORD_TIP = 102.0
loft(
    "sword_blade",
    [
        (SWORD_HAND[2] + 2.5, 0.75, 0.24, SWORD_HAND[0], SWORD_HAND[1]),
        (SWORD_TIP - 2.5, 0.6, 0.19, SWORD_HAND[0], SWORD_HAND[1]),
        (SWORD_TIP, 0.02, 0.02, SWORD_HAND[0], SWORD_HAND[1]),
    ],
    "neon",
    rings=12,
    sides=4,
    group="sword",
)

# Left arm: lifted out and up, the shield held high beside the head.
SHIELD_HAND = np.array([-9.4, 1.3, BASE + 41.0])
tube(
    "left_arm",
    [
        [-4.4, 0.0, BASE + 31.0],
        [-7.0, 0.4, BASE + 34.5],
        [-8.6, 0.9, BASE + 38.0],
        SHIELD_HAND - [0, 0, 0.5],
    ],
    [1.45, 1.2, 1.0, 0.85],
    "chrome",
    group="arm",
)
ellipsoid("left_fist", SHIELD_HAND, (1.05, 1.05, 1.2), "chrome", "arm")

# The shield: a heater outline 8 m wide and 12 m tall, its face turned a
# little outward from the figure's front, bowed so its centre stands proud.
SHIELD_TURN = np.radians(25.0)
SHIELD_U = np.array([np.cos(SHIELD_TURN), np.sin(SHIELD_TURN), 0.0])
SHIELD_N = np.array([-np.sin(SHIELD_TURN), np.cos(SHIELD_TURN), 0.0])
SHIELD_V = np.array([0.0, 0.0, 1.0])
SHIELD_CENTER = SHIELD_HAND + 1.0 * SHIELD_N + [-1.0, 0, -0.5]
SHIELD_OUTLINE = [
    (-4.0, 5.4), (-2.0, 5.9), (0.0, 6.1), (2.0, 5.9), (4.0, 5.4),
    (4.0, 1.4), (3.3, -2.1), (1.9, -4.5), (0.0, -5.9),
    (-1.9, -4.5), (-3.3, -2.1), (-4.0, 1.4),
]


def shield_point(u, v, lift=0.0):
    bow = 0.6 * (1.0 - (u / 4.0) ** 2) * (1.0 - (v / 6.1) ** 2)
    return SHIELD_CENTER + u * SHIELD_U + v * SHIELD_V + (bow + lift) * SHIELD_N


rim = len(SHIELD_OUTLINE)
front = [shield_point(0, 0)] + [shield_point(u, v) for u, v in SHIELD_OUTLINE]
back = [p - 0.7 * SHIELD_N for p in front]
shield_faces = []
for i in range(rim):
    a, b = i + 1, (i + 1) % rim + 1
    shield_faces.extend(
        [[0, a, b], [rim + 1, rim + 1 + b, rim + 1 + a], [a, rim + 1 + a, rim + 1 + b], [a, rim + 1 + b, b]]
    )
add("shield", np.vstack([front, back]), shield_faces, "chrome_dark", "shield")
# A rim of light around the shield, as the reference's shield glows.
tube(
    "shield_rim",
    [shield_point(u, v, 0.12) for u, v in SHIELD_OUTLINE + SHIELD_OUTLINE[:1]],
    [0.16, 0.16],
    "neon",
    n=96,
    sides=8,
    group="shield",
)
# The tryzub, the shield's crest since the monument's 2023 re-crest: a
# central prong, two side prongs curving up from a shared base, and the
# inner strokes that close the figure.
for stroke in (
    [(0.0, -3.2), (0.0, 0.5), (0.0, 3.6)],
    [(-0.5, -3.0), (-2.3, -2.2), (-2.7, 0.6), (-2.3, 3.0)],
    [(0.5, -3.0), (2.3, -2.2), (2.7, 0.6), (2.3, 3.0)],
    [(-1.7, -3.4), (0.0, -3.6), (1.7, -3.4)],
    [(0.0, -1.6), (-1.0, -0.8), (-1.3, 0.6)],
    [(0.0, -1.6), (1.0, -0.8), (1.3, 0.6)],
):
    tube(
        "tryzub",
        [shield_point(u, v, 0.18) for u, v in stroke],
        [0.2, 0.2],
        "neon",
        n=24,
        sides=8,
        group="shield",
    )

# The figure is authored at true scale, so this is a guard, not a fit: if a
# change above moved the sword tip off the documented 102 m, squeeze the
# figure vertically (x/y untouched, so silhouettes keep their shape) until
# it lands there again.
FIGURE_TOP_METERS = 102.0
authored_top = max(mesh.vertices[:, 2].max() for mesh in PARTS)
figure_scale = (FIGURE_TOP_METERS - BASE) / (authored_top - BASE)
for mesh in PARTS:
    vertices = mesh.vertices.copy()
    above_base = vertices[:, 2] > BASE
    vertices[above_base, 2] = BASE + (vertices[above_base, 2] - BASE) * figure_scale
    mesh.vertices = vertices

# glTF is Y-up: z (up) becomes +Y and the figure's front, +y, becomes -Z.
# Written out exactly, so the ground stays at exactly y = 0.
Y_UP = np.array(
    [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=float
)
for mesh in PARTS:
    mesh.apply_transform(Y_UP)

scene = trimesh.Scene(PARTS)
out_path = OUT / "motherland.glb"
out_path.write_bytes(trimesh.exchange.gltf.export_glb(scene))
print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")
