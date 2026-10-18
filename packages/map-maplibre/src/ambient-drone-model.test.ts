// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { Box3, BufferGeometry, Material, Mesh } from "three";
import { describe, expect, it, vi } from "vitest";
import { createAmbientDroneKit } from "./ambient-drone-model";
import { createAvatarLayer } from "./avatar-layer";

function meshes(root: { traverse(fn: (node: unknown) => void): void }) {
  const found: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh) found.push(node);
  });
  return found;
}

describe("ambient drones", () => {
  it("are small bounded props, a cargo drone carrying a parcel", () => {
    const kit = createAmbientDroneKit();
    const street = kit.build("street");
    const yard = kit.build("yard");
    for (const drone of [street, yard]) {
      drone.sample(0, true);
      const bounds = new Box3().setFromObject(drone.root);
      expect(bounds.max.x - bounds.min.x).toBeGreaterThan(0.6);
      expect(bounds.max.x - bounds.min.x).toBeLessThan(1);
      expect(bounds.min.y).toBeGreaterThan(1);
    }
    expect(meshes(street.root)).toHaveLength(meshes(yard.root).length + 1);
    // A handful of draw calls each, so a dozen of them stay cheap.
    expect(meshes(street.root).length).toBeLessThanOrEqual(9);
    kit.dispose();
  });

  it("share one set of geometry and materials across every drone", () => {
    const kit = createAmbientDroneKit();
    const first = meshes(kit.build("yard").root);
    const second = meshes(kit.build("yard").root);
    expect(second.map((mesh) => mesh.geometry)).toEqual(
      first.map((mesh) => mesh.geometry),
    );
    expect(second.map((mesh) => mesh.material)).toEqual(
      first.map((mesh) => mesh.material),
    );
    kit.dispose();
  });

  it("free shared parts only with the kit, never with one drone", () => {
    const geometry = vi.spyOn(BufferGeometry.prototype, "dispose");
    const material = vi.spyOn(Material.prototype, "dispose");
    const kit = createAmbientDroneKit();
    const drone = kit.build("street");
    drone.dispose();
    expect(geometry).not.toHaveBeenCalled();
    expect(material).not.toHaveBeenCalled();
    kit.dispose();
    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
    geometry.mockRestore();
    material.mockRestore();
  });

  it("hang level with rotors stopped when still", () => {
    const kit = createAmbientDroneKit();
    const drone = kit.build("street");
    drone.sample(0.3, false);
    drone.root.updateMatrixWorld(true);
    const still = JSON.stringify(drone.root.toJSON());
    drone.sample(0.7, false);
    drone.root.updateMatrixWorld(true);
    expect(JSON.stringify(drone.root.toJSON())).toEqual(still);
    drone.sample(0.7, true);
    drone.root.updateMatrixWorld(true);
    expect(JSON.stringify(drone.root.toJSON())).not.toEqual(still);
    kit.dispose();
  });

  it("go through the system prop surface without any avatar asset", () => {
    const loadAsset = vi.fn();
    const layer = createAvatarLayer({ loadAsset });
    layer.upsertDrone({
      id: "ambient:1:2:0",
      kind: "street",
      lngLat: [30.5, 50.4],
      bearingDeg: 90,
      phase: 0.4,
      reducedMotion: false,
      scale: 2.5,
    });
    expect(layer.hasInstances()).toBe(true);
    expect(loadAsset).not.toHaveBeenCalled();
    layer.remove("ambient:1:2:0");
    expect(layer.hasInstances()).toBe(false);
    layer.dispose();
  });
});
