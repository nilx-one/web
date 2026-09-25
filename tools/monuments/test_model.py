# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

"""Smoke test for the built monument asset — run after build_model.py.

Not a pixel-exact determinism check (there is no SHA256SUMS to pin here,
unlike the avatar studies): a low-poly static landmark has nothing depending
on frame-exact byte reproducibility. This instead asserts the shape a broken
build would get wrong — a truncated export, a collapsed or wildly rescaled
figure, a missing part — the same failures the height-rescale step in
build_model.py could silently produce if its assumptions stopped holding.

Run: python test_model.py [--input FILE]
"""
from pathlib import Path
import argparse

import trimesh

parser = argparse.ArgumentParser()
parser.add_argument(
    "--input", default="deploy/web/monuments/0.1.0/motherland.glb"
)
args = parser.parse_args()

path = Path(args.input)
assert path.is_file(), f"{path} was not built"

scene = trimesh.load(path)
assert isinstance(scene, trimesh.Scene), "expected a multi-part glTF scene"
assert len(scene.geometry) >= 15, (
    f"expected pedestal, torso, arms, sword and shield parts, got "
    f"{len(scene.geometry)}"
)

low, high = scene.bounds
assert low[2] == 0, f"the monument should stand on the ground, got z0={low[2]}"
# 102 m ± 1 m: build_model.py's own rescale step targets exactly 102 m: a
# larger drift means that step, or the sections it scales, broke.
assert 101.0 <= high[2] <= 103.0, f"expected ~102 m tall, got {high[2]:.1f} m"

footprint = high[:2] - low[:2]
assert (footprint > 5).all(), f"pedestal footprint collapsed: {footprint}"

print(f"motherland.glb: {len(scene.geometry)} parts, {high[2]:.1f} m tall — ok")
