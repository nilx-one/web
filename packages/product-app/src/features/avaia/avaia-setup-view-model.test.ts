// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  createAvaiaSetupViewState,
  type AvaiaSetupInput,
} from "./avaia-setup-view-model";

const profile = {
  pubDress: "0skai",
  ownerPubDress: "0x0sky",
  configurationState: "unconfigured",
} as const;

function input(overrides: Partial<AvaiaSetupInput> = {}): AvaiaSetupInput {
  return {
    load: { kind: "available", profile },
    pending: false,
    ...overrides,
  };
}

describe("Avaia setup surface", () => {
  it("presents the whole stored address rather than a name it assembled", () => {
    const state = createAvaiaSetupViewState(
      input({
        load: {
          kind: "available",
          profile: { ...profile, pubDress: "0vesnai" },
        },
        fallbackAddress: "0skai",
      }),
    );

    expect(state.address).toBe("0vesnai");
    expect(state.draft).toBe("0vesnai");
    expect(state.editable).toBe(true);
  });

  it("reads configuration from what was stored, and nothing else", () => {
    expect(createAvaiaSetupViewState(input()).configuration).toBe(
      "unconfigured",
    );
    expect(
      createAvaiaSetupViewState(
        input({
          load: {
            kind: "available",
            profile: { ...profile, configurationState: "configured" },
          },
        }),
      ).configuration,
    ).toBe("configured");
  });

  it("offers no save until the address is actually changed", () => {
    expect(createAvaiaSetupViewState(input()).canSave).toBe(false);
    expect(createAvaiaSetupViewState(input({ draft: "0skai" })).canSave).toBe(
      false,
    );
    expect(createAvaiaSetupViewState(input({ draft: "  " })).canSave).toBe(
      false,
    );
    expect(
      createAvaiaSetupViewState(input({ draft: "0vesnai", pending: true }))
        .canSave,
    ).toBe(false);
    expect(createAvaiaSetupViewState(input({ draft: "0vesnai" })).canSave).toBe(
      true,
    );
  });

  it("waits for a profile before offering anything to write", () => {
    const loading = createAvaiaSetupViewState(
      input({ load: { kind: "loading" }, fallbackAddress: "0skai" }),
    );

    expect(loading.editable).toBe(false);
    expect(loading.canSave).toBe(false);
    expect(loading.address).toBe("0skai");
    expect(loading.configuration).toBeUndefined();
    expect(loading.status).toBe("Reading this Avaia…");
  });

  it("keeps the service's refusal in the service's terms", () => {
    expect(
      createAvaiaSetupViewState(
        input({
          draft: "1skai",
          result: { kind: "rejected", reason: "owner-discriminator-mismatch" },
        }),
      ).error,
    ).toBe("An Avaia keeps the discriminator of the Bond that owns it.");
    expect(
      createAvaiaSetupViewState(
        input({ result: { kind: "rejected", reason: "unavailable" } }),
      ).error,
    ).toBe("That address belongs to another identity.");
    expect(
      createAvaiaSetupViewState(
        input({ result: { kind: "service-unavailable" } }),
      ).error,
    ).toBe("Couldn’t save this address. Try again.");
  });

  it("keeps a refused draft where the person left it", () => {
    const refused = createAvaiaSetupViewState(
      input({
        draft: "0takenai",
        result: { kind: "rejected", reason: "unavailable" },
      }),
    );

    expect(refused.draft).toBe("0takenai");
    expect(refused.canSave).toBe(true);
  });
});
