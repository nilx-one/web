// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { observation } from "../../../../../tests/support/doubles";
import { translate } from "../../shell/localization";
import {
  createLocationControlViewModel,
  type LocationControlTranslationKey,
} from "./location-control-view-model";

const en = (key: LocationControlTranslationKey) => translate("en", key);
const uk = (key: LocationControlTranslationKey) => translate("uk-UA", key);

describe("location control", () => {
  it("offers the explicit retry when the host still has to be asked", () => {
    const model = createLocationControlViewModel(
      { kind: "permission-required" },
      false,
      en,
    );

    expect(model.state).toBe("permission-required");
    expect(model.intent).toBe("request");
    expect(model.disabled).toBe(false);
  });

  it("carries an unsupported host itself instead of raising a toast", () => {
    const model = createLocationControlViewModel(
      { kind: "unsupported" },
      false,
      en,
    );

    expect(model.state).toBe("unsupported");
    expect(model.disabled).toBe(true);
    expect(model.intent).toBe("none");
    expect(model.label).not.toBe("");
  });

  it("keeps a denied permission askable only by an explicit gesture", () => {
    const model = createLocationControlViewModel(
      { kind: "denied" },
      false,
      en,
    );

    expect(model.state).toBe("denied");
    expect(model.intent).toBe("request");
  });

  it("separates a framed camera from a displaced one", () => {
    const position = observation();

    expect(
      createLocationControlViewModel({ kind: "active", position }, true, en)
        .state,
    ).toBe("centered");
    expect(
      createLocationControlViewModel({ kind: "active", position }, false, en)
        .state,
    ).toBe("displaced");
  });

  it("recenters on the retained observation after a transient failure", () => {
    const position = observation();
    const model = createLocationControlViewModel(
      { kind: "unavailable", reason: "timeout", position },
      false,
      en,
    );

    expect(model.state).toBe("unavailable");
    expect(model.intent).toBe("recenter");
  });

  it("asks again when a transient failure left nothing to recenter on", () => {
    const model = createLocationControlViewModel(
      { kind: "unavailable", reason: "position-unavailable" },
      false,
      en,
    );

    expect(model.intent).toBe("request");
  });

  it("blocks a second request while one is already resolving", () => {
    const model = createLocationControlViewModel(
      { kind: "locating" },
      false,
      en,
    );

    expect(model.state).toBe("locating");
    expect(model.disabled).toBe(true);
    expect(model.busy).toBe(true);
  });

  it("states location in words, never in colour alone", () => {
    const position = observation({ accuracyMeters: 18 });
    const model = createLocationControlViewModel(
      { kind: "active", position },
      true,
      en,
    );

    expect(model.label).toContain("this device");
    expect(model.hint).toContain("18");
  });

  it("projects the same active state through Ukrainian presentation copy", () => {
    const position = observation({ accuracyMeters: 18 });
    const model = createLocationControlViewModel(
      { kind: "active", position },
      true,
      uk,
    );

    expect(model.state).toBe("centered");
    expect(model.label).toBe("Мапа центрована на цьому пристрої");
    expect(model.hint).toBe("Точність близько 18 m.");
    expect(model.intent).toBe("recenter");
  });
});
