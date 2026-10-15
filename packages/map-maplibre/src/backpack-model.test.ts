// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { Bone, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { mountBackpack } from "./backpack-model";
import { readFileSync } from "node:fs";

describe("backpack attachment", () => {
  it("ships a self-contained model without studio lights or a camera", () => {
    const bytes = readFileSync(
      "packages/map-maplibre/src/assets/aiaiaiai-backpack.glb",
    );
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    const gltf = JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
    ) as {
      cameras?: unknown;
      extensionsUsed: string[];
      meshes: unknown[];
      buffers: { uri?: string }[];
    };
    expect(gltf.cameras).toBeUndefined();
    expect(gltf.extensionsUsed).not.toContain("KHR_lights_punctual");
    expect(gltf.meshes.length).toBeGreaterThan(0);
    expect(gltf.buffers.every((buffer) => buffer.uri === undefined)).toBe(true);
  });
  it("clones the asset and follows the animated chest rather than the map origin", () => {
    const body = new Object3D();
    const chest = new Bone();
    chest.name = "chest";
    chest.position.y = 1.4;
    body.add(chest);
    const asset = new Object3D();
    const mounted = mountBackpack(body, asset)!;
    expect(mounted.parent).toBe(chest);
    expect(mounted.children[0]).not.toBe(asset);
    expect(asset.parent).toBeNull();
    const before = mounted.getWorldPosition(new Vector3());
    chest.rotation.x = 0.4;
    expect(
      mounted.getWorldPosition(new Vector3()).distanceTo(before),
    ).toBeGreaterThan(0.05);
    expect(mounted.rotation.y).toBe(Math.PI);
  });

  it("does not float an item on an unsupported rig", () => {
    const body = new Object3D();
    expect(mountBackpack(body, new Object3D())).toBeUndefined();
    expect(body.children).toHaveLength(0);
  });
});
