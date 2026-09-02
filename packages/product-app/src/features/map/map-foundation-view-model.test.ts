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

  it("projects ready renderer state", () => {
    expect(createMapFoundationViewModel({ kind: "ready" })).toMatchObject({
      tone: "positive",
      label: "Map ready",
    });
  });
});
