// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  DEFAULT_AVATAR_MODEL,
  createAvatarChoiceViewState,
} from "./avatar-choice-view-model";

describe("avatar choice", () => {
  it("offers the three published studies and selects none by default", () => {
    const state = createAvatarChoiceViewState(undefined, undefined);

    expect(state.options.map((option) => option.model)).toEqual([
      "sky-study",
      "dasha-study",
      "kai-study",
    ]);
    expect(state.options.every((option) => !option.selected)).toBe(true);
    expect(state.unchosen).toBe(true);
    // Nobody is assigned a body: the world draws the neutral study until a
    // person chooses one.
    expect(state.rendered).toBe(DEFAULT_AVATAR_MODEL);
    expect(state.rendered).toBe("kai-study");
  });

  it("marks the stored choice and draws it", () => {
    const state = createAvatarChoiceViewState("dasha-study", undefined);

    expect(
      state.options.filter((option) => option.selected).map((o) => o.model),
    ).toEqual(["dasha-study"]);
    expect(state.rendered).toBe("dasha-study");
    expect(state.unchosen).toBe(false);
    expect(state.busy).toBe(false);
  });

  it("shows an in-flight choice as made while the service confirms it", () => {
    const state = createAvatarChoiceViewState("dasha-study", "sky-study");

    expect(state.rendered).toBe("sky-study");
    expect(state.busy).toBe(true);
    expect(
      state.options.find((option) => option.model === "sky-study")?.selected,
    ).toBe(true);
  });

  it("names what the service refused", () => {
    expect(
      createAvatarChoiceViewState("kai-study", undefined, {
        kind: "rejected",
        reason: "rate-limited",
      }).error,
    ).toBe("Too many changes. Wait before trying again.");
    expect(
      createAvatarChoiceViewState("kai-study", undefined, {
        kind: "service-unavailable",
      }).error,
    ).toBe("Couldn’t save this choice. Try again.");
  });

  it("describes each study by its own name", () => {
    const state = createAvatarChoiceViewState(undefined, undefined);

    expect(state.options).toMatchObject([
      { name: "Sky", detail: "masculine study" },
      { name: "Dasha", detail: "feminine study" },
      { name: "Kai", detail: "non-binary study" },
    ]);
  });
});
