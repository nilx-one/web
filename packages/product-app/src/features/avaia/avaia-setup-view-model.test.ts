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
    availability: "unavailable",
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

  it("edits identity while this device has no runtime at all", () => {
    const state = createAvaiaSetupViewState(
      input({ draft: "0vesnai", availability: "unavailable" }),
    );

    expect(state.aiModel.value).toBe("Not available yet");
    expect(state.canSave).toBe(true);
  });

  it("reads the runtime as a device fact, never as configuration", () => {
    expect(
      createAvaiaSetupViewState(input({ availability: "ready" })).aiModel.value,
    ).toBe("Ready on this device");
    expect(
      createAvaiaSetupViewState(input({ availability: "downloadable" })).aiModel
        .value,
    ).toBe("Ready to download");
    // A ready runtime says nothing about whether the owner configured anything.
    expect(
      createAvaiaSetupViewState(input({ availability: "ready" }))
        .configurationLabel,
    ).toBe("unconfigured");
  });

  it("keeps the render model independent of the model that would think", () => {
    const drawn = createAvaiaSetupViewState(
      input({ study: "dasha-study", availability: "unavailable" }),
    );

    expect(drawn.renderModel.value).toBe("Dasha — feminine study");
    expect(drawn.renderModel.study?.model).toBe("dasha-study");
    expect(drawn.aiModel.value).toBe("Not available yet");

    const undrawn = createAvaiaSetupViewState(input());
    expect(undrawn.renderModel.value).toBe("Not drawn yet");
    expect(undrawn.renderModel.study).toBeUndefined();
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
        input({ result: { kind: "service-unavailable" } }),
      ).error,
    ).toBe("Couldn’t save this address. Try again.");
  });

  it("confirms a save only once it reads the address the service answered", () => {
    const answered = {
      ...profile,
      pubDress: "0vesnai",
      configurationState: "configured",
    } as const;

    expect(
      createAvaiaSetupViewState(
        input({ result: { kind: "updated", profile: answered } }),
      ).saved,
    ).toBeUndefined();
    expect(
      createAvaiaSetupViewState(
        input({
          load: { kind: "available", profile: answered },
          result: { kind: "updated", profile: answered },
        }),
      ).saved,
    ).toBe("0vesnai");
  });
});
