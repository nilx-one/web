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
# The real monument stands on the museum's drum, a 40 m pylon; here it is a
# steel-blue drum banded with light, the way the reference render lights it:
# a broad footing, a lip under the figure's step, the step itself. Its
# footing covers the drum and the buttresses the basemap carries there,
# which the renderer cuts out of its own extrusion in favour of this.
PEDESTAL_HEIGHT = 40.0
PEDESTAL_FOOT = 3.0
PEDESTAL_LIP = 37.0
PEDESTAL_STEP_RADIUS = 11.2


def drum(name, z0, z1, r0, r1, mat="pedestal"):
    # Two sections loft as a straight cone: no overshoot, no barrel.
    loft(name, [(z0, r0, r0, 0, 0), (z1, r1, r1, 0, 0)], mat, rings=2, sides=96, group="pedestal")


def disc(name, z, r_outer, r_inner=0.0, mat="pedestal"):
    angles = np.linspace(0, 2 * np.pi, 97)[:-1]
    verts = [[r * np.sin(a), -r * np.cos(a), z] for r in (r_inner, r_outer) for a in angles]
    m = len(angles)
    faces = []
    for j in range(m):
        a0, a1 = j, (j + 1) % m
        faces.extend([[a0, a1, a1 + m], [a0, a1 + m, a0 + m]])
    add(name, verts, faces, mat, "pedestal")


drum("pedestal_footing", 0.0, PEDESTAL_FOOT, 20.0, 20.0)
disc("pedestal_footing_top", PEDESTAL_FOOT, 20.0, 17.5)
drum("pedestal", PEDESTAL_FOOT, PEDESTAL_LIP, 17.5, 15.0)
drum("pedestal_lip", PEDESTAL_LIP, PEDESTAL_LIP + 0.6, 15.7, 15.7)
disc("pedestal_lip_top", PEDESTAL_LIP + 0.6, 15.7, PEDESTAL_STEP_RADIUS)
drum("pedestal_step", PEDESTAL_LIP + 0.6, PEDESTAL_HEIGHT, PEDESTAL_STEP_RADIUS, PEDESTAL_STEP_RADIUS)
disc("pedestal_crown", PEDESTAL_HEIGHT, PEDESTAL_STEP_RADIUS)
# The reference's bands of light: a broad one low on the drum, one under
# the lip, and the step's own edge.
ring("pedestal_foot_ring", (0, 0), 17.4, PEDESTAL_FOOT + 1.2, "neon", thickness=0.45, group="pedestal")
ring("pedestal_lip_ring", (0, 0), 15.75, PEDESTAL_LIP + 0.3, "neon", thickness=0.2, group="pedestal")
ring("pedestal_crown_ring", (0, 0), PEDESTAL_STEP_RADIUS + 0.05, PEDESTAL_HEIGHT - 0.1, "neon", thickness=0.14, group="pedestal")

BASE = PEDESTAL_HEIGHT  # figure stands on top of the pedestal

# ---------------------------------------------------------------- figure
# Authored at true scale: the figure's feet at the 40 m pylon top, the sword
# tip at the monument's documented 102 m, a 16 m sword and a 13 m shield.
# She faces +y, her right hand on +x: sword raised straight up in the right
# hand, shield held high in the left. The reference's figure: a long skirt
# that falls almost as a column in deep vertical pleats, a banded bodice, a
# heavy mantle off her left shoulder, strong bare arms, short hair.
SKIRT = [
    (BASE + 0.0, 7.8, 6.6, 0, 0.0),
    (BASE + 2.0, 7.6, 6.4, 0, 0.1),
    (BASE + 10.0, 7.0, 5.9, 0, 0.2),
    (BASE + 18.0, 6.3, 5.2, 0, 0.3),
    (BASE + 23.0, 5.5, 4.4, 0, 0.3),
    (BASE + 24.5, 5.2, 4.0, 0, 0.25),
]
BODICE = [
    (BASE + 24.5, 5.2, 4.0, 0, 0.25),
    (BASE + 26.0, 5.3, 4.1, 0, 0.35),
    (BASE + 28.0, 5.6, 4.25, 0, 0.45),
    (BASE + 30.0, 5.9, 3.9, 0, 0.2),
    (BASE + 31.5, 4.7, 3.2, 0, -0.05),
    (BASE + 33.2, 1.8, 1.8, 0, -0.2),
]
HEM_RX, HEM_RY = SKIRT[0][1], SKIRT[0][2]
PLEATS = 22


def skirt_fold(z, a):
    # Sharp ridges, deepest at the hem and still there at the waist: the
    # reference's skirt is fluted like a column the whole way down.
    depth = 0.11 * (0.55 + 0.45 * float(np.clip((BASE + 24.0 - z) / 24.0, 0.0, 1.0)))
    return depth * (1.0 - 2.0 * abs(np.sin(PLEATS * a / 2.0)) ** 0.7)


loft("robe", SKIRT, "chrome", rings=64, sides=PLEATS * 10, group="torso", fold=skirt_fold)
loft("bodice", BODICE, "chrome", rings=32, sides=96, group="torso")


def band(name, z, rx, ry, cy, thickness, mat="chrome_dark"):
    """A strap round the bodice, following its ellipse."""
    angles = np.linspace(0, 2 * np.pi, 73)
    tube(name, [[rx * np.sin(a), cy - ry * np.cos(a), z] for a in angles], [thickness], mat, n=96, sides=8, group="torso")


# The bodice's straps under the bust, where the reference's armour is banded.
band("bodice_band_low", BASE + 24.9, 5.27, 4.07, 0.27, 0.32)
band("bodice_band_mid", BASE + 26.1, 5.36, 4.16, 0.35, 0.22)
band("bodice_band_high", BASE + 27.0, 5.46, 4.2, 0.4, 0.18)

# The mantle: off her left shoulder, round her back, down to the knee, its
# hem dipping lower behind. A sheet standing a little off the robe, folded.
mantle_angles = np.linspace(np.pi * 1.08, np.pi * 2.35, 64)
mantle_z = np.linspace(0.0, 1.0, 40)
robe_at = PchipInterpolator(
    [z for z, *_ in SKIRT + BODICE[1:]], [[rx, ry, cy] for _, rx, ry, _, cy in SKIRT + BODICE[1:]], axis=0
)
grid = []
for t in mantle_z:
    row = []
    for a in mantle_angles:
        # Hem: knee height at the front edge, lower behind her.
        behind = 0.5 + 0.5 * np.cos(a)
        bottom = BASE + 12.0 - 4.0 * behind
        top = BASE + 31.0 - 1.5 * abs(np.sin(a))
        z = bottom + (top - bottom) * t
        rx, ry, cy = robe_at(z)
        stand = 0.55 + 0.35 * (1 - t) + 0.25 * np.sin(9 * a) * (1 - t) ** 1.5
        row.append([(rx + stand) * np.sin(a), cy - (ry + stand) * np.cos(a), z])
    grid.append(row)
grid_mesh("mantle", grid, "chrome_dark", group="torso")

loft(
    "neck",
    [(BASE + 33.0, 1.5, 1.5, 0, -0.2), (BASE + 34.8, 1.4, 1.4, 0, -0.2)],
    "chrome",
    rings=4,
    sides=32,
    group="head",
)
# Head lifted a little, as the reference looks out over the city: a skull,
# a brow, a nose and a chin, and short hair swept back over the crown.
ellipsoid("head", (0, -0.05, BASE + 36.7), (1.85, 2.05, 2.45), "chrome", "head")
ellipsoid("brow", (0, 1.25, BASE + 37.55), (1.35, 0.6, 0.35), "chrome", "head")
ellipsoid("nose", (0, 1.95, BASE + 36.75), (0.28, 0.45, 0.65), "chrome", "head")
ellipsoid("chin", (0, 1.55, BASE + 35.1), (0.75, 0.6, 0.5), "chrome", "head")
ellipsoid("hair", (0, -0.45, BASE + 37.55), (2.0, 2.2, 1.75), "chrome_dark", "head")
ellipsoid("hair_back", (0, -1.75, BASE + 36.6), (1.55, 0.9, 1.35), "chrome_dark", "head")

# Shoulders under the drapery: the arms rise from them, not from the bodice.
ellipsoid("right_shoulder", (4.9, 0.05, BASE + 30.5), (2.3, 2.1, 2.0), "chrome_dark", "arm")
ellipsoid("left_shoulder", (-4.9, 0.05, BASE + 30.5), (2.3, 2.1, 2.0), "chrome_dark", "arm")

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
