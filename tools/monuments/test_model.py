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
    "--input", default="deploy/web/monuments/0.2.0/motherland.glb"
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
# glTF is Y-up: height is the second axis, the footprint the other two.
assert low[1] == 0, f"the monument should stand on the ground, got y0={low[1]}"
# 102 m ± 1 m: build_model.py authors the sword tip at exactly 102 m and
# guards it with a rescale step: a larger drift means either broke.
assert 101.0 <= high[1] <= 103.0, f"expected ~102 m tall, got {high[1]:.1f} m"

footprint = (high - low)[[0, 2]]
assert (footprint > 5).all(), f"pedestal footprint collapsed: {footprint}"
# Wider than the drum it stands in for, or the cut-out basemap pylon would
# leave a ring of bare ground around it.
assert (footprint >= 39).all(), f"pedestal narrower than the drum: {footprint}"

print(f"motherland.glb: {len(scene.geometry)} parts, {high[1]:.1f} m tall — ok")
