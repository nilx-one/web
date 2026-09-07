// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  UNSUPPORTED_GEOLOCATION_DOUBLE,
  createMapRendererDouble,
} from "../../../../../tests/support/doubles";
import { AuthenticatedMapHomeView } from "./authenticated-map-home-view";

describe("AuthenticatedMapHomeView map layout ownership", () => {
  it("mounts MapLibre into a full-size child host instead of the shell-owned surface", () => {
    const mapRenderer = createMapRendererDouble();
    const { container } = render(
      <AuthenticatedMapHomeView
        hostLabel="browser host"
        pubDress="0x0sky"
        renderer={mapRenderer}
        geolocation={UNSUPPORTED_GEOLOCATION_DOUBLE}
        runtime={{
          tone: "ready",
          label: "Shared Core ready",
          detail: "Contract 0.1.0 is available to the Web client.",
        }}
        safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );

    const surface = container.querySelector<HTMLElement>(
      ".authenticated-map-home__map",
    );
    const host = container.querySelector<HTMLElement>(
      ".authenticated-map-home__map-host",
    );

    expect(surface).not.toBeNull();
    expect(host).not.toBeNull();
    expect(surface).toContainElement(host);
    expect(host).toHaveStyle({ width: "100%", height: "100%" });
    expect(mapRenderer.mount).toHaveBeenCalledWith(host);
    expect(mapRenderer.mount).not.toHaveBeenCalledWith(surface);
  });
});
