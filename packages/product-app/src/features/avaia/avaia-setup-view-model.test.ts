// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  composeAvaiaPubDress,
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
  it("exposes only the editable Avaia slug stem", () => {
    const state = createAvaiaSetupViewState(
      input({
        load: {
          kind: "available",
          profile: { ...profile, pubDress: "0vesnai" },
        },
        fallbackAddress: "0skai",
      }),
    );

    expect(state).toMatchObject({
      address: "0vesnai",
      prefix: "0",
      slugStem: "vesn",
      suffix: "ai",
      candidatePubDress: "0vesnai",
      editable: true,
    });
  });

  it("keeps both contract-owned affixes out of draft state", () => {
    const state = createAvaiaSetupViewState(input({ draftSlugStem: "sync." }));

    expect(state).toMatchObject({
      prefix: "0",
      slugStem: "sync.",
      suffix: "ai",
      candidatePubDress: "0sync.ai",
    });
  });

  it("reconstructs a service request from the stored discriminator", () => {
    expect(composeAvaiaPubDress("0skai", "sync.")).toBe("0sync.ai");
    expect(composeAvaiaPubDress("fvesnai", "new")).toBe("fnewai");
    expect(composeAvaiaPubDress("not-an-avaia", "new")).toBeUndefined();
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

  it("offers no save until the slug stem is actually changed", () => {
    expect(createAvaiaSetupViewState(input()).canSave).toBe(false);
    expect(
      createAvaiaSetupViewState(input({ draftSlugStem: "sk" })).canSave,
    ).toBe(false);
    expect(
      createAvaiaSetupViewState(
        input({ draftSlugStem: "vesn", pending: true }),
      ).canSave,
    ).toBe(false);
    expect(
      createAvaiaSetupViewState(input({ draftSlugStem: "vesn" })).canSave,
    ).toBe(true);
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
          draftSlugStem: "sk",
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

  it("keeps a refused slug draft where the person left it", () => {
    const refused = createAvaiaSetupViewState(
      input({
        draftSlugStem: "taken",
        result: { kind: "rejected", reason: "unavailable" },
      }),
    );

    expect(refused.slugStem).toBe("taken");
    expect(refused.candidatePubDress).toBe("0takenai");
    expect(refused.canSave).toBe(true);
  });
});
