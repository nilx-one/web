// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { IdentityAccessPort } from "@nilx-one/application";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  UNSUPPORTED_GEOLOCATION_DOUBLE,
  createMapRendererDouble,
} from "../../../../../tests/support/doubles";
import { AvaiaProfileProvider } from "../avaia/avaia-profile-context";
import { AuthenticatedMapHomeView } from "./authenticated-map-home-view";

it(
  "opens persisted Avaia setup without replacing the world and caches save",
  async () => {
    const readAvaiaProfile = vi.fn().mockResolvedValue({
      kind: "available",
      profile: {
        pubDress: "0x0skai",
        ownerPubDress: "0x0sky",
        configurationState: "unconfigured",
        modelRef: null,
      },
    });
    const updateAvaiaProfile = vi.fn().mockResolvedValue({
      kind: "updated",
      profile: {
        pubDress: "0x0aurorai",
        ownerPubDress: "0x0sky",
        configurationState: "configured",
        modelRef: null,
      },
    });
    const identity = {
      readAvaiaProfile,
      updateAvaiaProfile,
    } as unknown as IdentityAccessPort;
    const renderer = createMapRendererDouble({ kind: "ready" });

    render(
      <AvaiaProfileProvider identity={identity}>
        <AuthenticatedMapHomeView
          hostLabel="browser host"
          pubDress="0x0sky"
          avaiaPubDress="0x0skai"
          renderer={renderer}
          geolocation={UNSUPPORTED_GEOLOCATION_DOUBLE}
          runtime={{
            tone: "ready",
            label: "Shared Core ready",
            detail: "Contract 0.1.0 is available to the Web client.",
          }}
          safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
          avaiaAvailability="unavailable"
        />
      </AvaiaProfileProvider>,
    );

    const setup = await screen.findByRole("button", { name: "Set up 0x0skai" });
    expect(setup).toHaveTextContent("unconfigured");
    expect(setup).toBeEnabled();
    fireEvent.click(setup);

    expect(screen.getByRole("heading", { name: "0x0skai" })).toBeVisible();
    expect(screen.getByLabelText("Avaia public address")).toHaveValue("0x0skai");
    expect(screen.getByLabelText("Model")).toBeDisabled();
    expect(screen.getByLabelText("Model")).toHaveValue("Not available yet");
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Avaia public address"), {
      target: { value: "0x0aurorai" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Avaia" }));

    expect(updateAvaiaProfile).toHaveBeenCalledExactlyOnceWith("0x0aurorai");
    expect(await screen.findByText("Avaia saved")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Edit 0x0aurorai" }),
    ).toBeEnabled();
    expect(screen.queryByLabelText("Avaia public address")).toBeNull();
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(renderer.unmount).not.toHaveBeenCalled();
  },
);
