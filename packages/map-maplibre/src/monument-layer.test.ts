// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AdditiveBlending,
  BufferGeometry,
  Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
  type DirectionalLight,
  type HemisphereLight,
  Matrix4,
  Object3D,
  PerspectiveCamera,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import {
  MONUMENT_ASSET_URL,
  MONUMENT_LAYER_ID,
  MOTHERLAND_MONUMENT_LOCATION,
  cameraCentre,
  createMonumentLayer,
  monumentLights,
  monumentLightsOf,
  orientMonument,
} from "./monument-layer";
import { MOTHERLAND_MONUMENT_FACING_DEG } from "./monument-site";

describe("monument presentation contract", () => {
  it("keeps the model asset on the versioned same-origin path", () => {
    expect(MONUMENT_ASSET_URL).toBe("/monuments/0.4.0/motherland.glb");
  });

  it("sites the monument at its real-world coordinates", () => {
    // Kyiv, not anywhere else on Earth — a stray sign flip or swapped
    // lng/lat would still be "a number", so this is checked against the
    // actual city bounding box rather than just `toBeDefined`.
    expect(MOTHERLAND_MONUMENT_LOCATION.lng).toBeGreaterThan(30);
    expect(MOTHERLAND_MONUMENT_LOCATION.lng).toBeLessThan(31);
    expect(MOTHERLAND_MONUMENT_LOCATION.lat).toBeGreaterThan(50);
    expect(MOTHERLAND_MONUMENT_LOCATION.lat).toBeLessThan(51);
  });

  it("exposes a 3d custom layer that starts hidden in flat presentation", () => {
    const layer = createMonumentLayer();
    expect(layer.id).toBe(MONUMENT_LAYER_ID);
    expect(layer.type).toBe("custom");
    expect(layer.renderingMode).toBe("3d");
    // No map has mounted it yet; setDimension and dispose must both be safe
    // to call before onAdd, the way an unmounted renderer can reach them.
    expect(() => layer.setDimension("volumetric")).not.toThrow();
    expect(() => layer.dispose()).not.toThrow();
    // Disposing twice — an unmount racing a teardown — must stay a no-op.
    expect(() => layer.dispose()).not.toThrow();
  });

  it("lets a style swap remove and re-add the layer without onRemove killing it for good", () => {
    // MapLibre's setStyle removes and re-adds every custom layer; onRemove
    // has to leave the layer able to load again, unlike dispose(), which is
    // the one call that closes the door for good.
    const layer = createMonumentLayer();
    // The implementation never reads either argument, so any placeholder
    // satisfies the interface's declared signature.
    const detachedRemove = () => layer.onRemove?.({} as never, {} as never);
    expect(detachedRemove).not.toThrow();
    expect(detachedRemove).not.toThrow();
    expect(() => layer.dispose()).not.toThrow();
  });
});

describe("monument orientation", () => {
  // Where a glTF direction of the asset ends up in the layer's frame:
  // x east, y south (Mercator), z up.
  function placed(direction: [number, number, number]): Vector3 {
    const root = new Object3D();
    orientMonument(root, 1);
    root.updateMatrixWorld(true);
    return new Vector3(...direction).transformDirection(root.matrixWorld);
  }

  it("stands the figure upright, not lying on the ground", () => {
    const up = placed([0, 1, 0]);
    expect(up.z).toBeCloseTo(1);
  });

  it("faces her north-east, toward the Dnipro", () => {
    const front = placed([0, 0, -1]);
    const bearing = (Math.atan2(front.x, -front.y) * 180) / Math.PI;
    expect(bearing).toBeCloseTo(MOTHERLAND_MONUMENT_FACING_DEG);
    expect(front.z).toBeCloseTo(0);
  });

  it("keeps the sword in her right hand, on her south-east side", () => {
    const right = placed([1, 0, 0]);
    const bearing = (Math.atan2(right.x, -right.y) * 180) / Math.PI;
    expect(bearing).toBeCloseTo(MOTHERLAND_MONUMENT_FACING_DEG + 90);
  });
});

describe("monument light", () => {
  it("finds the camera a view-projection was made from", () => {
    const camera = new PerspectiveCamera(40, 1.5, 1, 5_000);
    camera.position.set(120, -340, 260);
    camera.lookAt(0, 0, 50);
    camera.updateMatrixWorld(true);
    const viewProjection = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const found = cameraCentre(viewProjection, new Vector3());
    expect(found.x).toBeCloseTo(120, 3);
    expect(found.y).toBeCloseTo(-340, 3);
    expect(found.z).toBeCloseTo(260, 3);
  });

  it("lights her cold: a pale sky, a white key and a cyan rim", () => {
    const [sky, key, rim] = monumentLights() as [
      HemisphereLight,
      DirectionalLight,
      DirectionalLight,
    ];
    expect(sky.color.b).toBeGreaterThan(sky.color.r);
    expect(sky.groundColor.b).toBeGreaterThan(sky.groundColor.r);
    expect(key.intensity).toBeGreaterThan(rim.intensity);
    expect(rim.color.g + rim.color.b).toBeGreaterThan(2 * rim.color.r);
    // The key comes from in front of her, the rim from behind her.
    const facing = (MOTHERLAND_MONUMENT_FACING_DEG * Math.PI) / 180;
    const front = new Vector3(Math.sin(facing), -Math.cos(facing), 0);
    expect(key.position.dot(front)).toBeGreaterThan(0);
    expect(rim.position.dot(front)).toBeLessThan(0);
  });
});

describe("her light by day and by night", () => {
  function model() {
    const root = new Object3D();
    const neon = new MeshStandardMaterial({ name: "neon" });
    neon.emissive.setRGB(0.35, 4.4, 5.4);
    const emblem = new MeshStandardMaterial({
      name: "emblem",
      color: 0xffd500,
    });
    const glow = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    glow.name = "glow_sword_halo_a";
    root.add(
      new Mesh(new BufferGeometry(), neon),
      new Mesh(new BufferGeometry(), emblem),
      glow,
    );
    return { root, neon, emblem, glow };
  }

  it("burns only in the dark", () => {
    const { root, neon, emblem, glow } = model();
    const lights = monumentLightsOf(root);

    lights.show("dark");
    expect(glow.visible).toBe(true);
    expect(neon.emissive.b).toBeGreaterThan(1);
    expect(emblem.emissive.b).toBeGreaterThan(1);

    lights.show("light");
    expect(glow.visible).toBe(false);
    expect(neon.emissive.getHex()).toBe(0);
    // By day the coat of arms is its own gold, not lit.
    expect(emblem.emissive.getHex()).toBe(0);
    expect(emblem.color.getHex()).toBe(0xffd500);

    lights.show("dark");
    expect(neon.emissive.b).toBeGreaterThan(1);
  });

  it("draws the parts made of light additively, without depth", () => {
    const { root, glow } = model();
    monumentLightsOf(root);
    const material = glow.material as unknown as MeshBasicMaterial;
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.vertexColors).toBe(true);
  });
});
