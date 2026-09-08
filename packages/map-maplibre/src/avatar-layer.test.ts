// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  AVATAR_ASSET_URLS,
  AVATAR_LAYER_ID,
  createAvatarLayer,
  sampleAmbientAvatar,
} from "./avatar-layer";

describe("avatar presentation contract", () => {
  it("keeps every model asset on the versioned same-origin path", () => {
    expect(AVATAR_ASSET_URLS["sky-study"]).toBe("/avatars/0.1.0/sky-study.glb");
    expect(AVATAR_ASSET_URLS["dasha-study"]).toBe(
      "/avatars/0.1.0/dasha-study.glb",
    );
  });

  it("samples ambient clips deterministically without inference input", () => {
    expect(sampleAmbientAvatar(42, 12_345)).toEqual(
      sampleAmbientAvatar(42, 12_345),
    );
    expect(sampleAmbientAvatar(42, 12_345, true)).toEqual({
      clipId: "idle",
      clipPhase: 0,
    });
  });

  it("exposes a 3d custom layer while keeping handles explicit", () => {
    const layer = createAvatarLayer({ now: () => 0 });
    expect(layer.id).toBe(AVATAR_LAYER_ID);
    expect(layer.type).toBe("custom");
    expect(layer.renderingMode).toBe("3d");
    layer.upsert({
      id: "local-study-preview",
      modelId: "sky-study",
      lngLat: [30.5234, 50.4501],
      bearingDeg: 0,
      clipId: "idle",
      clipPhase: 0,
      scale: 1,
      visible: false,
    });
    layer.remove("local-study-preview");
    layer.dispose();
  });
});
