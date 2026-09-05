// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { createMapFoundationViewModel } from "./map-foundation-view-model";

describe("createMapFoundationViewModel", () => {
  it("explains an unpublished self-hosted style without inventing fallback state", () => {
    expect(
      createMapFoundationViewModel({
        kind: "unavailable",
        reason: "style-load-failed",
      }),
    ).toEqual({
      tone: "negative",
      label: "Map unavailable",
      detail: "The versioned self-hosted map style is not published yet.",
    });
  });

  it("separates an unreadable basemap archive from an unpublished style", () => {
    expect(
      createMapFoundationViewModel({
        kind: "unavailable",
        reason: "basemap-load-failed",
      }),
    ).toEqual({
      tone: "negative",
      label: "Map unavailable",
      detail: "The versioned self-hosted basemap archive could not be read.",
    });
  });

  it("projects ready renderer state", () => {
    expect(createMapFoundationViewModel({ kind: "ready" })).toMatchObject({
      tone: "positive",
      label: "Map ready",
    });
  });
});
