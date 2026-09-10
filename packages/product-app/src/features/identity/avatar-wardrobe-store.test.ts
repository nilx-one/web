// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AVATAR_WARDROBE_STORAGE_KEY,
  forgetAvatarChoices,
  readAvatarChoice,
  writeAvatarChoice,
} from "./avatar-wardrobe-store";

afterEach(() => {
  vi.restoreAllMocks();
  forgetAvatarChoices();
});

describe("what a body wears, kept on this device", () => {
  it("remembers nothing for an address that never chose", () => {
    expect(readAvatarChoice("0x0sky")).toEqual({});
  });

  it("survives being read back after it was written", () => {
    writeAvatarChoice("0x0sky", {
      appearances: { "dasha-v2-study": '{"hair":"hair/loose-long"}' },
    });
    expect(readAvatarChoice("0x0sky").appearances).toEqual({
      "dasha-v2-study": '{"hair":"hair/loose-long"}',
    });
  });

  it("keeps each study's clothes apart from every other study's", () => {
    writeAvatarChoice("0x0sky", {
      appearances: {
        "dasha-v2-study": '{"top":"top/shell-ecru"}',
        "sky-study": "{}",
      },
    });
    const stored = readAvatarChoice("0x0sky");
    expect(stored.appearances?.["dasha-v2-study"]).toBe(
      '{"top":"top/shell-ecru"}',
    );
    expect(stored.appearances?.["sky-study"]).toBe("{}");
  });

  it("keeps one address's wardrobe out of another's", () => {
    writeAvatarChoice("0x0sky", { appearances: { "sky-study": "{}" } });
    writeAvatarChoice("0aiaiaiai", { modelId: "kai-study" });
    expect(readAvatarChoice("0x0sky").modelId).toBeUndefined();
    expect(readAvatarChoice("0aiaiaiai").appearances).toBeUndefined();
  });

  it("answers with the same object until something actually changes", () => {
    writeAvatarChoice("0x0sky", { modelId: "kai-study" });
    expect(readAvatarChoice("0x0sky")).toBe(readAvatarChoice("0x0sky"));
    writeAvatarChoice("0x0sky", { modelId: "sky-study" });
    expect(readAvatarChoice("0x0sky").modelId).toBe("sky-study");
  });

  it("forgets an address that has nothing left to say", () => {
    writeAvatarChoice("0x0sky", { modelId: "kai-study" });
    writeAvatarChoice("0x0sky", {});
    expect(readAvatarChoice("0x0sky")).toEqual({});
    expect(
      window.localStorage.getItem(AVATAR_WARDROBE_STORAGE_KEY),
    ).not.toContain("0x0sky");
  });

  it("ignores stored text that is not a wardrobe", () => {
    window.localStorage.setItem(AVATAR_WARDROBE_STORAGE_KEY, "[1,2,3]");
    forgetAvatarChoices();
    window.localStorage.setItem(AVATAR_WARDROBE_STORAGE_KEY, "[1,2,3]");
    expect(readAvatarChoice("0x0sky")).toEqual({});
  });

  it("ignores entries of the wrong shape rather than throwing", () => {
    window.localStorage.setItem(
      AVATAR_WARDROBE_STORAGE_KEY,
      JSON.stringify({ "0x0sky": { modelId: 7, appearances: { a: 9 } } }),
    );
    forgetAvatarChoices();
    window.localStorage.setItem(
      AVATAR_WARDROBE_STORAGE_KEY,
      JSON.stringify({ "0x0sky": { modelId: 7, appearances: { a: 9 } } }),
    );
    expect(readAvatarChoice("0x0sky")).toEqual({});
  });

  it("holds a change for this session on a host that refuses storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    writeAvatarChoice("0x0sky", { modelId: "kai-study" });
    expect(readAvatarChoice("0x0sky").modelId).toBe("kai-study");
  });
});
