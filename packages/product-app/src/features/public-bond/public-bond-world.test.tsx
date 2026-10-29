// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMapRendererDouble } from "../../../../../tests/support/doubles";
import {
  PublicBondWorld,
  type PublicBondScreen,
  type PublicBondWorldBond,
} from "./public-bond-world";

afterEach(cleanup);

const BOND: PublicBondWorldBond = {
  pubDress: "0x0sky",
  publicUrl: "https://0x0sky.nilx.one/",
  experience: { bondXp: 560, avaiaXp: 920 },
  avaia: {
    pubDress: "x0skai",
    configured: true,
    avatarModel: "sky-study",
    location: { longitude: 30.563, latitude: 50.4265 },
  },
};

function renderWorld(screenName: PublicBondScreen, bond = BOND) {
  const renderer = createMapRendererDouble({ kind: "ready" });
  const onBack = vi.fn();
  const onOpenAvaia = vi.fn();
  const rendered = render(
    <PublicBondWorld
      renderer={renderer}
      appearance="dark"
      bond={bond}
      screen={screenName}
      onBack={onBack}
      onOpenAvaia={onOpenAvaia}
    />,
  );
  return { renderer, onBack, onOpenAvaia, ...rendered };
}

describe("PublicBondWorld", () => {
  it("draws the world under the Bond's main screen", () => {
    const { renderer, container, onBack, onOpenAvaia } = renderWorld("bond");

    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.setAppearance).toHaveBeenCalledWith("dark");
    expect(container.querySelector(".authenticated-map-home")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    expect(container.querySelector(".bond-dock")).toHaveAttribute(
      "data-screen",
      "bond",
    );
    expect(
      container.querySelector(".bond-dock__detail-header h2"),
    ).toHaveTextContent(/^0x0sky$/);
    expect(
      screen.getByRole("link", { name: /0x0sky\.nilx\.one/ }),
    ).toHaveAttribute("href", "https://0x0sky.nilx.one/");
    // Nothing on a public page edits anything.
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open x0skai" }));
    expect(onOpenAvaia).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("stands the Avaia where its owner published it, in its body", () => {
    const { renderer } = renderWorld("bond");

    expect(renderer.avatars?.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "sky-study",
        lngLat: [30.563, 50.4265],
        visible: true,
      }),
    );
  });

  it("draws no body it does not know, and none without a location", () => {
    const unknown = renderWorld("bond", {
      ...BOND,
      avaia: { ...BOND.avaia!, avatarModel: "future-study" },
    });
    expect(unknown.renderer.avatars?.upsert).not.toHaveBeenCalled();
    cleanup();
    const { location: _location, ...nowhere } = BOND.avaia!;
    const placeless = renderWorld("bond", { ...BOND, avaia: nowhere });
    expect(placeless.renderer.avatars?.upsert).not.toHaveBeenCalled();
  });

  it("reads the Avaia one level down and brings the world to it", () => {
    const { renderer, container } = renderWorld("avaia");

    expect(
      container.querySelector(".bond-dock__detail-header h2"),
    ).toHaveTextContent(/^x0skai$/);
    expect(screen.getByText("50.4265, 30.5630")).toBeVisible();
    expect(screen.getByText("Sky")).toBeVisible();
    expect(screen.getByText("0x0sky")).toBeVisible();
    expect(renderer.setCamera).toHaveBeenCalledWith(
      expect.objectContaining({ center: [30.563, 50.4265] }),
      { motion: "eased" },
    );
  });

  it("says an unknown address under the Bond is not there", () => {
    renderWorld("missing");

    expect(screen.getByRole("status")).toHaveTextContent(
      "No Bond is allocated to this public address.",
    );
  });
});
