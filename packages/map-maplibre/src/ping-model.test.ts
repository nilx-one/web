// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AVATAR_MODEL_IDS } from "@nilx-one/map-contract";
import { Box3, Mesh, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { airDensity, createPingModel } from "./ping-model";
import { bodyOrientation, createAvatarLayer } from "./avatar-layer";

describe("xPing system prop", () => {
  it("has actual bounded 3D geometry and deterministic reduced motion", () => {
    const model = createPingModel();
    model.sample(0, false);
    const bounds = new Box3().setFromObject(model.root);
    expect(bounds.min.y).toBeGreaterThan(1.5);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(1);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(1.5);
    const initial = JSON.stringify(model.root.toJSON());
    model.sample(0.5, false);
    model.root.updateMatrixWorld(true);
    expect(JSON.stringify(model.root.toJSON())).toEqual(initial);
    model.sample(0.2, true);
    model.root.updateMatrixWorld(true);
    expect(JSON.stringify(model.root.toJSON())).not.toEqual(initial);
    expect(AVATAR_MODEL_IDS).not.toContain("system-ping");
    model.dispose();
  });
  it("smokes thicker and sparks oftener the more worn its engine is", () => {
    const model = createPingModel();
    const part = (name: string) => {
      let found: Mesh | undefined;
      model.root.traverse((node) => {
        if (node instanceof Mesh && node.name === name) found = node;
      });
      return found!;
    };
    const smoke = part("ping-smoke");
    const spark = part("ping-spark");
    const opacity = (mesh: Mesh) =>
      (mesh.material as { opacity: number }).opacity;
    model.sample(0.25, true, 0);
    const soundOpacity = opacity(smoke);
    const soundScale = smoke.scale.x;
    model.sample(0.25, true, 1);
    expect(opacity(smoke)).toBeGreaterThan(soundOpacity * 3);
    expect(smoke.scale.x).toBeGreaterThan(soundScale * 3);
    // At this phase a sound engine does not spark; a spent one does.
    model.sample(0.4, true, 0);
    expect(spark.visible).toBe(false);
    model.sample(0.4, true, 1);
    expect(spark.visible).toBe(true);
    // Reduced motion draws no smoke or sparks, worn or not.
    model.sample(0.4, false, 1);
    expect(smoke.visible).toBe(false);
    expect(spark.visible).toBe(false);
    model.dispose();
  });
  it("sheds clots of air that thicken from its cruise to its top speed", () => {
    expect(airDensity(30)).toBe(0);
    expect(airDensity(60)).toBeCloseTo(0.5);
    expect(airDensity(90)).toBe(1);
    expect(airDensity(120)).toBe(1);
    expect(airDensity(Number.NaN)).toBe(0);
    const model = createPingModel();
    const clots: Mesh[] = [];
    model.root.traverse((node) => {
      if (node instanceof Mesh && node.name === "ping-air") clots.push(node);
    });
    const shown = () => clots.filter((clot) => clot.visible);
    const thickness = () =>
      shown().reduce(
        (sum, clot) => sum + (clot.material as { opacity: number }).opacity,
        0,
      );
    model.sample(0.3, true, 0, 30);
    expect(shown()).toHaveLength(0);
    model.sample(0.3, true, 0, 45);
    const thin = thickness();
    expect(shown().length).toBeGreaterThan(0);
    model.sample(0.3, true, 0, 90);
    expect(shown()).toHaveLength(clots.length);
    expect(thickness()).toBeGreaterThan(thin * 2);
    // Reduced motion gathers no air, however fast.
    model.sample(0.3, false, 0, 90);
    expect(shown()).toHaveLength(0);
    model.dispose();
  });
  it("renders nitro jets and streaks above cruise", () => {
    const model = createPingModel();
    const named = (name: string) => {
      const found: Mesh[] = [];
      model.root.traverse((node) => {
        if (node instanceof Mesh && node.name === name) found.push(node);
      });
      return found;
    };
    const flames = named("ping-boost-flame");
    const cores = named("ping-boost-core");
    const streaks = named("ping-speed-streak");
    const anyLit = () =>
      [...flames, ...cores, ...streaks].some((mesh) => mesh.visible);
    expect(flames).toHaveLength(2);
    expect(cores).toHaveLength(2);
    expect(streaks).toHaveLength(8);
    model.sample(0.25, true, 0, 30);
    expect(anyLit()).toBe(false);
    model.sample(0.25, true, 0, 60);
    const halfLength = flames[0]!.scale.y;
    const halfStreaks = streaks.filter((mesh) => mesh.visible).length;
    expect(flames.every((mesh) => mesh.visible)).toBe(true);
    expect(cores.every((mesh) => mesh.visible)).toBe(true);
    expect(halfStreaks).toBeGreaterThan(0);
    model.sample(0.25, true, 0, 90);
    expect(flames[0]!.scale.y).toBeGreaterThan(halfLength);
    expect(streaks.filter((mesh) => mesh.visible)).toHaveLength(8);
    model.sample(0.25, true, 0, 30);
    expect(anyLit()).toBe(false);
    model.sample(0.25, false, 0, 90);
    expect(anyLit()).toBe(false);
    model.dispose();
  });
  it("disposes its owned geometry and materials", () => {
    const model = createPingModel();
    const disposals: ReturnType<typeof vi.fn>[] = [];
    model.root.traverse((node) => {
      if (node instanceof Mesh) {
        const spy = vi.fn();
        node.geometry.addEventListener("dispose", spy);
        disposals.push(spy);
      }
    });
    model.dispose();
    expect(disposals.length).toBeGreaterThan(8);
    for (const spy of disposals) expect(spy).toHaveBeenCalledOnce();
  });
  it("uses a separate prop capability with no avatar asset request", () => {
    const loadAsset = vi.fn();
    const layer = createAvatarLayer({ loadAsset });
    layer.upsertDrone({
      id: "system:xPing",
      lngLat: [30.5, 50.4],
      bearingDeg: 180,
      phase: 0,
      reducedMotion: true,
    });
    expect(layer.hasInstances()).toBe(true);
    expect(loadAsset).not.toHaveBeenCalled();
    layer.remove("system:xPing");
    expect(layer.hasInstances()).toBe(false);
    layer.dispose();
  });
  it("leans its nose down and banks its right side down", () => {
    // Mercator: x east, y south, z up.
    const nose = (q: ReturnType<typeof bodyOrientation>) =>
      new Vector3(0, 0, 1).applyQuaternion(q);
    const right = (q: ReturnType<typeof bodyOrientation>) =>
      new Vector3(1, 0, 0).applyQuaternion(q);
    const level = bodyOrientation(0);
    expect(nose(level).y).toBeCloseTo(-1);
    expect(nose(level).z).toBeCloseTo(0);
    expect(right(level).x).toBeCloseTo(1);
    expect(nose(bodyOrientation(90)).x).toBeCloseTo(1);
    expect(nose(bodyOrientation(0, 0, 20)).z).toBeLessThan(-0.3);
    expect(nose(bodyOrientation(0, 0, 20)).y).toBeLessThan(-0.9);
    expect(right(bodyOrientation(0, 0, 0, 30)).z).toBeLessThan(-0.45);
    expect(right(bodyOrientation(0, 0, 0, -30)).z).toBeGreaterThan(0.45);
    // A turn east still banks the side on its right: the south.
    expect(right(bodyOrientation(90, 0, 0, 30))).toMatchObject({
      y: expect.closeTo(0.866, 2),
      z: expect.closeTo(-0.5, 2),
    });
  });
});
