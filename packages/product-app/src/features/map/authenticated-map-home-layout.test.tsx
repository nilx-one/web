// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";
import type { MapRenderer, MapRendererStatus } from "@nilx-one/map-contract";
import { describe, expect, it, vi } from "vitest";

import { AuthenticatedMapHomeView } from "./authenticated-map-home-view";

function renderer(): MapRenderer {
  return {
    mount: vi.fn(),
    unmount: vi.fn(),
    getStatus: vi.fn((): MapRendererStatus => ({ kind: "ready" })),
    subscribe: vi.fn(() => () => undefined),
    setCamera: vi.fn(),
    setAppearance: vi.fn(),
  };
}

describe("AuthenticatedMapHomeView map layout ownership", () => {
  it("mounts MapLibre into a full-size child host instead of the shell-owned surface", () => {
    const mapRenderer = renderer();
    const { container } = render(
      <AuthenticatedMapHomeView
        hostLabel="browser host"
        pubDress="0x0sky"
        renderer={mapRenderer}
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
