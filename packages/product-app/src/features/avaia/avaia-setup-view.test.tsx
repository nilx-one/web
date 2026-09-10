// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AvaiaSetupView } from "./avaia-setup-view";
import { createAvaiaSetupViewState } from "./avaia-setup-view-model";

describe("AvaiaSetupView", () => {
  it("keeps the discriminator and ai suffix outside the editable control", () => {
    const onDraftChange = vi.fn();
    const state = createAvaiaSetupViewState({
      load: {
        kind: "available",
        profile: {
          pubDress: "0skai",
          ownerPubDress: "0x0sky",
          configurationState: "configured",
        },
      },
      pending: false,
    });

    const { container } = render(
      <AvaiaSetupView
        state={state}
        onDraftChange={onDraftChange}
        onSubmit={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("pub_dress");
    expect(input).toHaveValue("sk");
    expect(
      container.querySelector(".profile-edit__discriminator"),
    ).toHaveTextContent("0");
    const suffix = container.querySelector(".profile-edit__affix");
    expect(suffix).toHaveTextContent("ai");
    expect(suffix?.tagName).toBe("SPAN");

    fireEvent.change(input, { target: { value: "sync." } });

    expect(onDraftChange).toHaveBeenCalledExactlyOnceWith("sync.");
  });
});
