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
from shapely.geometry import Polygon
from shapely.ops import unary_union
from svgelements import SVG, Path as SvgPath, Shape
import trimesh
from trimesh.visual import ColorVisuals
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
    "pedestal": ("#355d78", 0.34, 0.70, None),
    "neon": ("#5be7ff", 0.10, 0.05, (0.35, 4.4, 5.4)),
    "neon_warm": ("#ffe9a8", 0.10, 0.05, (5.4, 4.2, 1.6)),
    # The coat of arms in its own colours: a deep blue field and a tryzub of
    # polished gold. In the dark theme the layer lights the gold up as neon.
    "shield_field": ("#0d2f55", 0.35, 0.30, None),
    "emblem": ("#ffd500", 0.30, 0.70, None),
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


def glow(name, verts, faces, brightness):
    """
    A part made only of light, drawn by the layer additively and only in the
    dark theme. Its brightness rides on its vertex colours, black for none,
    so it fades out at its edges with no texture and no alpha.
    """
    mesh = trimesh.Trimesh(
        vertices=np.asarray(verts), faces=np.asarray(faces), process=False
    )
    level = np.clip(np.asarray(brightness, dtype=float), 0.0, 1.0)
    rgb = np.outer(level, [0.36, 0.91, 1.0]) * 255
    rgba = np.column_stack([rgb, np.full(len(level), 255)]).astype(np.uint8)
    mesh.visual = ColorVisuals(mesh=mesh, vertex_colors=rgba)
    mesh.metadata = {"name": f"glow_{name}", "group": "glow", "material": "glow"}
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
# The real pylon under her: a steep truncated cone of titanium panels rising
# from the museum's roof, girded at its foot by sloped piers, and topped by
# a short collar ring with a railing, which her hem stands on. Its footing
# covers the drum and the buttresses the basemap carries there, which the
# renderer cuts out of its own extrusion in favour of this.
PEDESTAL_HEIGHT = 40.0
PEDESTAL_FOOT = 3.0
PEDESTAL_COLLAR = 36.0
PEDESTAL_STEP_RADIUS = 10.4
CONE_BOTTOM_RADIUS = 17.5
CONE_TOP_RADIUS = 10.0


def drum(name, z0, z1, r0, r1, mat="pedestal", sides=96):
    # Two sections loft as a straight cone: no overshoot, no barrel.
    loft(name, [(z0, r0, r0, 0, 0), (z1, r1, r1, 0, 0)], mat, rings=2, sides=sides, group="pedestal")


def disc(name, z, r_outer, r_inner=0.0, mat="pedestal"):
    angles = np.linspace(0, 2 * np.pi, 97)[:-1]
    verts = [[r * np.sin(a), -r * np.cos(a), z] for r in (r_inner, r_outer) for a in angles]
    m = len(angles)
    faces = []
    for j in range(m):
        a0, a1 = j, (j + 1) % m
        faces.extend([[a0, a1, a1 + m], [a0, a1 + m, a0 + m]])
    add(name, verts, faces, mat, "pedestal")


def cone_radius(z):
    t = (z - PEDESTAL_FOOT) / (PEDESTAL_COLLAR - PEDESTAL_FOOT)
    return CONE_BOTTOM_RADIUS + (CONE_TOP_RADIUS - CONE_BOTTOM_RADIUS) * t


drum("pedestal_footing", 0.0, PEDESTAL_FOOT, 20.0, 20.0)
disc("pedestal_footing_top", PEDESTAL_FOOT, 20.0, CONE_BOTTOM_RADIUS)
drum("pedestal", PEDESTAL_FOOT, PEDESTAL_COLLAR, CONE_BOTTOM_RADIUS, CONE_TOP_RADIUS)
disc("pedestal_shoulder", PEDESTAL_COLLAR, CONE_TOP_RADIUS + 0.4, PEDESTAL_STEP_RADIUS)
drum("pedestal_step", PEDESTAL_COLLAR, PEDESTAL_HEIGHT, PEDESTAL_STEP_RADIUS, PEDESTAL_STEP_RADIUS)
disc("pedestal_crown", PEDESTAL_HEIGHT, PEDESTAL_STEP_RADIUS)
# The railing round the collar's top: a rail on short posts.
ring("pedestal_rail", (0, 0), PEDESTAL_STEP_RADIUS - 0.25, PEDESTAL_HEIGHT + 1.1, "chrome_dark", thickness=0.07, group="pedestal")
for k in range(36):
    a = 2 * np.pi * k / 36
    r = PEDESTAL_STEP_RADIUS - 0.25
    tube(
        "pedestal_rail_post",
        [[r * np.sin(a), -r * np.cos(a), PEDESTAL_HEIGHT], [r * np.sin(a), -r * np.cos(a), PEDESTAL_HEIGHT + 1.1]],
        [0.05, 0.05],
        "chrome_dark",
        n=2,
        sides=4,
        group="pedestal",
    )
# Sloped piers round the cone's foot, as the museum's corners rise into it.
for k in range(8):
    a = 2 * np.pi * (k + 0.5) / 8
    out = np.array([np.sin(a), -np.cos(a), 0.0])
    side = np.array([np.cos(a), np.sin(a), 0.0])
    foot_in, foot_out, top_out, width, top_z = 15.5, 20.5, 17.0, 2.6, 13.0
    corners = []
    for z, r_in, r_out, half in (
        (PEDESTAL_FOOT, foot_in, foot_out, width / 2),
        (top_z, cone_radius(top_z) - 0.6, top_out, width / 2 * 0.7),
    ):
        for r in (r_in, r_out):
            for sgn in (-1, 1):
                corners.append(out * r + side * sgn * half + [0, 0, z])
    faces = [
        [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5],
        [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
        [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
    ]
    add(f"pedestal_pier_{k}", corners, faces, "pedestal", "pedestal")
# The bands of light, by night: low on the cone, at its shoulder, and at
# the collar's edge under her feet.
ring("pedestal_foot_ring", (0, 0), cone_radius(PEDESTAL_FOOT + 11.0) + 0.06, PEDESTAL_FOOT + 11.0, "neon", thickness=0.4, group="pedestal")
ring("pedestal_lip_ring", (0, 0), CONE_TOP_RADIUS + 0.45, PEDESTAL_COLLAR + 0.05, "neon", thickness=0.2, group="pedestal")
ring("pedestal_crown_ring", (0, 0), PEDESTAL_STEP_RADIUS + 0.05, PEDESTAL_HEIGHT - 0.1, "neon", thickness=0.14, group="pedestal")

BASE = PEDESTAL_HEIGHT  # figure stands on top of the pedestal

# ---------------------------------------------------------------- figure
# Authored at true scale: the figure's feet at the 40 m pylon top, the sword
# tip at the monument's documented 102 m, a 16 m sword and a 13 m shield.
# She faces +y, her right hand on +x. As the statue is cast: a long dress
# falling as a column in deep pleats from a belt high under the bust, a
# bodice gathered down its middle under a ribbed stand-up collar, broad
# drapery hanging from both raised arms like folded wings — longer on her
# left — and a cloak across her back between them; hair swept back into a
# knot.
BELT = BASE + 26.5
SKIRT = [
    (BASE + 0.0, 7.4, 6.4, 0, 0.0),
    (BASE + 2.0, 7.2, 6.2, 0, 0.1),
    (BASE + 12.0, 6.6, 5.6, 0, 0.2),
    (BASE + 20.0, 6.0, 4.9, 0, 0.3),
    (BELT, 5.3, 4.1, 0, 0.25),
]
BODICE = [
    (BELT, 5.3, 4.1, 0, 0.25),
    (BASE + 28.5, 5.5, 4.2, 0, 0.35),
    (BASE + 30.5, 5.8, 3.9, 0, 0.2),
    (BASE + 32.0, 4.6, 3.1, 0, 0.0),
    (BASE + 33.0, 2.2, 2.0, 0, -0.1),
]
HEM_RX, HEM_RY = SKIRT[0][1], SKIRT[0][2]
PLEATS = 26


def skirt_fold(z, a):
    # Sharp ridges the whole way down, a little deeper toward the hem: the
    # dress is fluted like a column.
    depth = 0.085 + 0.03 * float(np.clip((BELT - z) / (BELT - BASE), 0.0, 1.0))
    return depth * (1.0 - 2.0 * abs(np.sin(PLEATS * a / 2.0)) ** 0.7)


loft("robe", SKIRT, "chrome", rings=72, sides=PLEATS * 9, group="torso", fold=skirt_fold)
loft("bodice", BODICE, "chrome", rings=32, sides=96, group="torso")
robe_at = PchipInterpolator(
    [z for z, *_ in SKIRT + BODICE[1:]], [[rx, ry, cy] for _, rx, ry, _, cy in SKIRT + BODICE[1:]], axis=0
)


def band(name, z, thickness, mat="chrome_dark", swell=0.0):
    """A belt or a fold round the figure, following her ellipse at `z`."""
    rx, ry, cy = robe_at(z)
    angles = np.linspace(0, 2 * np.pi, 73)
    tube(
        name,
        [[(rx + swell) * np.sin(a), cy - (ry + swell) * np.cos(a), z] for a in angles],
        [thickness],
        mat,
        n=96,
        sides=8,
        group="torso",
    )


# The belt high under the bust, and the fold the dress makes above it.
band("belt", BELT + 0.1, 0.38)
band("belt_fold", BELT - 0.9, 0.22, "chrome", swell=0.1)

# The bust, and the bodice gathered in vertical folds down its middle from
# the collar to the belt.
for side in (-1, 1):
    ellipsoid(f"bust_{'right' if side > 0 else 'left'}", (1.75 * side, 3.55, BASE + 29.4), (1.45, 0.95, 1.35), "chrome", "torso")
for k, x in enumerate(np.linspace(-0.9, 0.9, 7)):
    path = []
    for z in np.linspace(BELT + 0.3, BASE + 32.6, 8):
        rx, ry, cy = robe_at(z)
        front = cy + ry * np.sqrt(max(0.0, 1.0 - (x / rx) ** 2))
        path.append([x, front + 0.12, z])
    tube(f"bodice_gather_{k}", path, [0.16, 0.13], "chrome", n=16, sides=6, group="torso")


def collar_fold(z, a):
    return 0.08 * (1.0 - 2.0 * abs(np.sin(9 * a)) ** 0.8)


# The ribbed stand-up collar, then the neck above it.
loft("collar", [(BASE + 32.6, 2.05, 1.95, 0, -0.1), (BASE + 34.3, 1.85, 1.75, 0, -0.15)], "chrome", rings=6, sides=72, group="head", fold=collar_fold)
loft(
    "neck",
    [(BASE + 34.2, 1.45, 1.45, 0, -0.2), (BASE + 35.0, 1.4, 1.4, 0, -0.2)],
    "chrome",
    rings=4,
    sides=32,
    group="head",
)
# Head lifted a little, as she looks out over the city: a skull, a brow, a
# nose and a chin, hair swept back in a wave over the crown into a knot.
ellipsoid("head", (0, -0.05, BASE + 36.8), (1.85, 2.05, 2.45), "chrome", "head")
ellipsoid("brow", (0, 1.25, BASE + 37.65), (1.35, 0.6, 0.35), "chrome", "head")
ellipsoid("nose", (0, 1.95, BASE + 36.85), (0.28, 0.45, 0.65), "chrome", "head")
ellipsoid("chin", (0, 1.55, BASE + 35.2), (0.75, 0.6, 0.5), "chrome", "head")
ellipsoid("hair", (0, -0.4, BASE + 37.65), (2.05, 2.2, 1.8), "chrome_dark", "head")
ellipsoid("hair_wave", (0, 0.9, BASE + 38.6), (1.7, 1.1, 0.7), "chrome_dark", "head")
ellipsoid("hair_knot", (0, -2.25, BASE + 36.9), (1.05, 0.95, 1.05), "chrome_dark", "head")

# Shoulders under the drapery: the arms rise from them, not from the bodice.
ellipsoid("right_shoulder", (4.9, 0.05, BASE + 30.5), (2.3, 2.1, 2.0), "chrome", "arm")
ellipsoid("left_shoulder", (-4.9, 0.05, BASE + 30.5), (2.3, 2.1, 2.0), "chrome", "arm")


def wing(name, side, bottom, back_y=-3.0, front_y=2.4):
    """
    The drapery hanging from a raised arm: a broad cloth falling outside her
    side from the shoulder, in deep vertical folds that open out as it falls,
    its hem stepped longer at the back.
    """
    us = np.linspace(0.0, 1.0, 40)
    ts = np.linspace(0.0, 1.0, 36)
    grid = []
    for t in ts:
        row = []
        for u in us:
            y = back_y + (front_y - back_y) * u
            hem = bottom - 2.5 * (1.0 - u)
            z = BASE + 31.6 - (BASE + 31.6 - hem) * t
            rx, _, _ = robe_at(min(max(z, BASE), BASE + 33.0))
            fold = (0.25 + 0.55 * t) * np.sin(7 * np.pi * u)
            x = side * (rx + 0.9 + 0.6 * t + fold)
            row.append([x, y, z])
        grid.append(row)
    grid_mesh(name, grid, "chrome", group="torso")


wing("drapery_right", 1, BASE + 17.0)
wing("drapery_left", -1, BASE + 13.0)

# The cloak across her back between the two, down to the knee.
cloak_angles = np.linspace(-0.62 * np.pi, 0.62 * np.pi, 56)
grid = []
for t in np.linspace(0.0, 1.0, 36):
    row = []
    for a in cloak_angles:
        bottom = BASE + 12.0 + 3.0 * abs(np.sin(a))
        z = BASE + 31.2 + (bottom - (BASE + 31.2)) * t
        rx, ry, cy = robe_at(z)
        stand = 0.55 + 0.35 * t + 0.22 * np.sin(11 * a) * t
        row.append([(rx + stand) * np.sin(a), cy - (ry + stand) * np.cos(a), z])
    grid.append(row)
grid_mesh("cloak", grid, "chrome", group="torso")

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
    [2.0, 1.6, 1.35, 1.1],
    "chrome",
    group="arm",
)
ellipsoid("right_fist", SWORD_HAND, (1.3, 1.3, 1.45), "chrome", "arm")
# The hilt: a grip ringed at both ends and a pommel below her fist, and an
# ornate cross-guard — a bar with a boss at its middle and scrolls curling
# at its ends.
tube("sword_grip", [SWORD_HAND - [0, 0, 1.8], SWORD_HAND + [0, 0, 1.9]], [0.45, 0.45], "chrome_dark", n=4, group="sword")
ellipsoid("sword_pommel", SWORD_HAND - [0, 0, 2.2], (0.65, 0.65, 0.55), "chrome_dark", "sword")
for z in (-1.4, 1.5):
    ring("sword_grip_ring", SWORD_HAND[:2], 0.47, SWORD_HAND[2] + z, "chrome_dark", thickness=0.1, group="sword")
GUARD_Z = SWORD_HAND[2] + 2.25
tube("sword_guard", [[SWORD_HAND[0] - 2.2, SWORD_HAND[1], GUARD_Z], [SWORD_HAND[0] + 2.2, SWORD_HAND[1], GUARD_Z]], [0.42, 0.42], "chrome_dark", n=4, group="sword")
ellipsoid("sword_guard_boss", [SWORD_HAND[0], SWORD_HAND[1], GUARD_Z], (0.8, 0.55, 0.7), "chrome_dark", "sword")
for side in (-1, 1):
    tube(
        "sword_guard_scroll",
        [
            [SWORD_HAND[0] + side * (2.2 + 0.5 * np.sin(a)), SWORD_HAND[1], GUARD_Z + 0.5 - 0.5 * np.cos(a)]
            for a in np.linspace(0, 1.6 * np.pi, 10)
        ],
        [0.26, 0.18],
        "chrome_dark",
        n=24,
        sides=8,
        group="sword",
    )
# The blade: straight, flat and broad, rectangular in section, its tip cut
# square across at a slant as the statue's is. It is the one solid of light
# on the figure by night.
SWORD_TIP = 102.0
BLADE_FOOT = GUARD_Z + 0.4
BLADE_WIDTH, BLADE_THICKNESS, TIP_CUT = 1.5, 0.42, 1.8
cx, cy = SWORD_HAND[0], SWORD_HAND[1]
blade = []
for z, half_w, half_t, slant in (
    (BLADE_FOOT, BLADE_WIDTH / 2, BLADE_THICKNESS / 2, False),
    (SWORD_TIP, BLADE_WIDTH * 0.45, BLADE_THICKNESS * 0.45, True),
):
    for sx in (-1, 1):
        for sy in (-1, 1):
            top = z - (TIP_CUT * (1 - sx) / 2 if slant else 0.0)
            blade.append([cx + sx * half_w, cy + sy * half_t, top])
add(
    "sword_blade",
    blade,
    [
        [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5],
        [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
        [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
    ],
    "neon",
    "sword",
)
# Its halo: two crossed sheets through the blade, brightest along the edge
# and fading to nothing 1.8 m out, so the sword glows from any side.
HALO_HALF_WIDTH = 1.8
for name, across in (("sword_halo_a", [1.0, 0.0, 0.0]), ("sword_halo_b", [0.0, 1.0, 0.0])):
    across = np.asarray(across)
    columns = np.linspace(-1.0, 1.0, 9)
    heights = np.linspace(SWORD_HAND[2] + 2.2, SWORD_TIP, 14)
    verts, faces, level = [], [], []
    for row, z in enumerate(heights):
        taper = 1.0 - 0.6 * (row / (len(heights) - 1))
        for column in columns:
            verts.append(
                [SWORD_HAND[0], SWORD_HAND[1], z]
                + across * column * HALO_HALF_WIDTH * taper
            )
            level.append((1.0 - abs(column)) ** 2.2)
    width = len(columns)
    for row in range(len(heights) - 1):
        for column in range(width - 1):
            a0 = row * width + column
            faces.extend([[a0, a0 + 1, a0 + width + 1], [a0, a0 + width + 1, a0 + width]])
    glow(name, verts, faces, level)

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
    [2.0, 1.6, 1.35, 1.1],
    "chrome",
    group="arm",
)
ellipsoid("left_fist", SHIELD_HAND, (1.3, 1.3, 1.45), "chrome", "arm")

# The shield is the Lesser Coat of Arms of Ukraine itself, drawn from its
# vector (tools/monuments/third_party/coat-of-arms): the shield's own outline,
# 13 m tall as the monument's is, and the tryzub standing proud of its face.
# Its face is turned a little outward from the figure's front.
SHIELD_TURN = np.radians(25.0)
SHIELD_U = np.array([np.cos(SHIELD_TURN), np.sin(SHIELD_TURN), 0.0])
SHIELD_N = np.array([-np.sin(SHIELD_TURN), np.cos(SHIELD_TURN), 0.0])
SHIELD_V = np.array([0.0, 0.0, 1.0])
SHIELD_HEIGHT = 13.0
SHIELD_CENTER = SHIELD_HAND + 1.2 * SHIELD_N + [-1.4, 0, 1.5]
COAT_OF_ARMS = Path(__file__).resolve().parents[1] / "third_party" / "coat-of-arms" / "UA.svg"


def svg_polygons(path_file):
    """The coat of arms' fills as shapely polygons, by colour, in SVG units."""
    fills = {}
    for element in SVG.parse(str(path_file), reify=True).elements():
        if not isinstance(element, Shape) or isinstance(element, SVG):
            continue
        shape = None
        for sub in SvgPath(element).as_subpaths():
            sub = SvgPath(sub)
            n = max(12, int(sub.length(error=1e-4) / 0.6))
            ring = Polygon([(p.x, p.y) for p in (sub.point(i / n) for i in range(n))]).buffer(0)
            # Even-odd: a subpath inside another is a hole in it.
            shape = ring if shape is None else shape.symmetric_difference(ring)
        key = str(element.fill).lower()
        fills[key] = shape if key not in fills else unary_union([fills[key], shape])
    return fills


FILLS = svg_polygons(COAT_OF_ARMS)
FIELD = FILLS["#005bbb"]
TRYZUB = FILLS["#ffd500"]
min_x, min_y, max_x, max_y = FIELD.bounds
SVG_SCALE = SHIELD_HEIGHT / (max_y - min_y)
SVG_CENTRE = ((min_x + max_x) / 2, (min_y + max_y) / 2)


def on_shield(u, v, lift):
    return SHIELD_CENTER + u * SHIELD_U + v * SHIELD_V + lift * SHIELD_N


def emboss(name, shape, depth, lift, mat):
    """Extrudes an SVG fill `depth` thick, standing `lift` off the shield."""
    for k, polygon in enumerate(getattr(shape, "geoms", [shape])):
        flat = Polygon(
            [((x - SVG_CENTRE[0]) * SVG_SCALE, -(y - SVG_CENTRE[1]) * SVG_SCALE) for x, y in polygon.exterior.coords],
            [
                [((x - SVG_CENTRE[0]) * SVG_SCALE, -(y - SVG_CENTRE[1]) * SVG_SCALE) for x, y in hole.coords]
                for hole in polygon.interiors
            ],
        ).simplify(0.01)
        solid = trimesh.creation.extrude_polygon(flat, depth)
        verts = np.array([on_shield(u, v, lift + w) for u, v, w in solid.vertices])
        add(name if k == 0 else f"{name}_{k}", verts, solid.faces, mat, "shield")


emboss("shield", FIELD, 0.7, -0.7, "shield_field")
emboss("tryzub", TRYZUB, 0.28, 0.0, "emblem")
# The rim: gold like the tryzub, as the coat of arms draws it, and lit with
# it in the dark theme.
outline = list(FIELD.exterior.coords)
step = max(1, len(outline) // 160)
tube(
    "shield_rim",
    [
        on_shield((x - SVG_CENTRE[0]) * SVG_SCALE, -(y - SVG_CENTRE[1]) * SVG_SCALE, 0.12)
        for x, y in outline[::step] + outline[:1]
    ],
    [0.22, 0.22],
    "emblem",
    n=200,
    sides=8,
    group="shield",
)

# Light under her feet: a pool on the plinth's crown, brightest at the hem
# and gone by the crown's edge, and a low curtain rising from it round the
# hem, as the reference lights the figure from below.
pool_radii = np.linspace(HEM_RX - 1.0, PEDESTAL_STEP_RADIUS, 9)
pool_angles = np.linspace(0, 2 * np.pi, 97)[:-1]
verts, faces, level = [], [], []
for r in pool_radii:
    for a in pool_angles:
        verts.append([r * np.sin(a), -r * np.cos(a), BASE + 0.06])
        level.append(max(0.0, 1.0 - abs(r - (HEM_RX + 0.2)) / (PEDESTAL_STEP_RADIUS - HEM_RX)) ** 1.6)
m = len(pool_angles)
for i in range(len(pool_radii) - 1):
    for j in range(m):
        a0, a1 = i * m + j, i * m + (j + 1) % m
        faces.extend([[a0, a1, a1 + m], [a0, a1 + m, a0 + m]])
glow("feet_pool", verts, faces, level)

curtain_heights = np.linspace(0.0, 5.0, 8)
verts, faces, level = [], [], []
for z in curtain_heights:
    for a in pool_angles:
        verts.append([(HEM_RX + 0.4 - 0.1 * z) * np.sin(a), -(HEM_RY + 0.4 - 0.1 * z) * np.cos(a), BASE + z])
        level.append((1.0 - z / curtain_heights[-1]) ** 2)
for i in range(len(curtain_heights) - 1):
    for j in range(m):
        a0, a1 = i * m + j, i * m + (j + 1) % m
        faces.extend([[a0, a1, a1 + m], [a0, a1 + m, a0 + m]])
glow("feet_curtain", verts, faces, level)

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

# Many small parts of one material are one mesh each in the export: the
# railing's posts, the piers, the bodice's gathers, the hilt's rings and
# scrolls. Fewer meshes, fewer draw calls, the same shape.
MERGE = {
    "pedestal_rail_post": "pedestal_rail_posts",
    "pedestal_pier_": "pedestal_piers",
    "bodice_gather_": "bodice_gathers",
    "sword_grip_ring": "sword_grip_rings",
    "sword_guard_scroll": "sword_guard_scrolls",
}
merged = {}
kept = []
for mesh in PARTS:
    name = mesh.metadata["name"]
    key = next((target for prefix, target in MERGE.items() if name.startswith(prefix)), None)
    if key is None:
        kept.append(mesh)
    else:
        merged.setdefault(key, []).append(mesh)
for name, meshes in merged.items():
    combined = trimesh.util.concatenate(meshes)
    combined.visual = TextureVisuals(material=MATERIALS[meshes[0].metadata["material"]])
    combined.metadata = {**meshes[0].metadata, "name": name}
    kept.append(combined)
PARTS[:] = kept

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
