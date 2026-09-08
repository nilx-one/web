// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  createProfileSlugViewState,
  pubDressParts,
} from "./profile-slug-view-model";

describe("pub_dress parts", () => {
  it("separates the discriminator a Bond keeps from the slug it may change", () => {
    expect(pubDressParts("0x0sky")).toEqual({
      discriminator: "0",
      slug: "sky",
    });
    expect(pubDressParts("0xfНебо")).toEqual({
      discriminator: "f",
      slug: "Небо",
    });
  });

  it("refuses anything that is not a canonical address", () => {
    expect(pubDressParts("0sky")).toBeUndefined();
    expect(pubDressParts("0xzsky")).toBeUndefined();
  });
});

describe("profile slug state", () => {
  it("shows the current address with nothing to save", () => {
    expect(
      createProfileSlugViewState("0x0sky", undefined, false),
    ).toMatchObject({
      kind: "editable",
      discriminator: "0",
      slug: "sky",
      preview: "0x0sky",
      canSave: false,
      busy: false,
    });
  });

  it("saves only a changed slug within the canonical bounds", () => {
    expect(createProfileSlugViewState("0x0sky", "rain", false).canSave).toBe(
      true,
    );
    expect(createProfileSlugViewState("0x0sky", "sky", false).canSave).toBe(
      false,
    );
    expect(createProfileSlugViewState("0x0sky", "r", false)).toMatchObject({
      canSave: false,
      error: "Use 2–32 characters.",
    });
    expect(
      createProfileSlugViewState("0x0sky", "r".repeat(33), false).canSave,
    ).toBe(false);
  });

  it("counts the slug in Unicode scalars rather than UTF-16 units", () => {
    expect(createProfileSlugViewState("0x0sky", "🌧🌤", false)).toMatchObject({
      canSave: true,
      preview: "0x0🌧🌤",
    });
  });

  it("stops offering a save while one is in flight", () => {
    expect(createProfileSlugViewState("0x0sky", "rain", true)).toMatchObject({
      busy: true,
      canSave: false,
    });
  });

  it("names what the service refused", () => {
    expect(
      createProfileSlugViewState("0x0sky", "rain", false, {
        kind: "rejected",
        reason: "unavailable",
      }).error,
    ).toBe("That address belongs to another Bond.");
    expect(
      createProfileSlugViewState("0x0sky", "rain", false, {
        kind: "rejected",
        reason: "avaia-unavailable",
      }).error,
    ).toBe("The Avaia address this name derives is taken. Choose another.");
    expect(
      createProfileSlugViewState("0x0sky", "rain", false, {
        kind: "service-unavailable",
      }).error,
    ).toBe("Couldn’t save this address. Try again.");
  });

  it("confirms a save only once the surface holds the new address", () => {
    const result = {
      kind: "renamed" as const,
      identity: { pubDress: "0x0rain" },
    };

    expect(
      createProfileSlugViewState("0x0sky", "rain", false, result).saved,
    ).toBeUndefined();
    expect(
      createProfileSlugViewState("0x0rain", undefined, false, result),
    ).toMatchObject({ saved: "0x0rain", slug: "rain", canSave: false });
  });

  it("presents an address it cannot split as fixed", () => {
    expect(
      createProfileSlugViewState("legacy", undefined, false),
    ).toMatchObject({ kind: "fixed", canSave: false, preview: "legacy" });
  });
});
