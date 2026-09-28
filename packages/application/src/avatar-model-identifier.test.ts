// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  AVATAR_MODEL_DIGEST_HEX_LENGTHS,
  classifyAvatarModelIdentifier,
  isAvatarModelDigest,
} from "./avatar-model-identifier";
import { AVATAR_MODELS } from "./identity-registration";

describe("Avatar model identifier", () => {
  it("recognises every published study by name", () => {
    for (const model of AVATAR_MODELS) {
      expect(classifyAvatarModelIdentifier(model)).toEqual({
        kind: "study",
        model,
      });
    }
  });

  it("accepts a digest of 64, 128 or 256 bits", () => {
    for (const length of AVATAR_MODEL_DIGEST_HEX_LENGTHS) {
      const digest = "a1".repeat(length / 2);
      expect(isAvatarModelDigest(digest)).toBe(true);
      expect(classifyAvatarModelIdentifier(digest)).toEqual({
        kind: "digest",
        digest,
        bits: length * 4,
      });
    }
  });

  it("refuses a digest of any other width or alphabet", () => {
    expect(isAvatarModelDigest("a1".repeat(4))).toBe(false);
    expect(isAvatarModelDigest("a1".repeat(12))).toBe(false);
    expect(isAvatarModelDigest("a1".repeat(48))).toBe(false);
    expect(isAvatarModelDigest("A1".repeat(8))).toBe(false);
    expect(isAvatarModelDigest("g1".repeat(8))).toBe(false);
    expect(isAvatarModelDigest("")).toBe(false);
    expect(isAvatarModelDigest(16)).toBe(false);
  });

  it("preserves a study a newer runtime published as unknown", () => {
    expect(classifyAvatarModelIdentifier("lera-study")).toEqual({
      kind: "unknown",
      value: "lera-study",
    });
  });

  it("never mistakes a study name for a digest", () => {
    for (const model of AVATAR_MODELS) {
      expect(isAvatarModelDigest(model)).toBe(false);
    }
  });
});
