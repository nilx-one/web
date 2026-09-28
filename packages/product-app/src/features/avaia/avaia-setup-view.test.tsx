// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AVAIA_TYPING_DELAY_MS,
  AVAIA_TYPING_STEP_MS,
  AvaiaSetupView,
} from "./avaia-setup-view";
import { createAvaiaSetupViewState } from "./avaia-setup-view-model";

describe("AvaiaSetupView", () => {
  it("keeps the discriminator and ai suffix outside the editable control", () => {
    const onDraftChange = vi.fn();
    const state = createAvaiaSetupViewState({
      load: {
        kind: "available",
        profile: {
          pubDress: "x0skai",
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
    ).toHaveTextContent("x0");
    const suffix = container.querySelector(".profile-edit__affix");
    expect(suffix).toHaveTextContent("ai");
    expect(suffix?.tagName).toBe("SPAN");

    fireEvent.change(input, { target: { value: "sync." } });

    expect(onDraftChange).toHaveBeenCalledExactlyOnceWith("sync.");
  });

  describe("an Avaia nobody configured", () => {
    const unconfigured = createAvaiaSetupViewState({
      load: {
        kind: "available",
        profile: {
          pubDress: "xda-shai",
          ownerPubDress: "0xda-sha",
          configurationState: "unconfigured",
        },
      },
      pending: false,
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("types out the address it already holds, then offers Save", () => {
      vi.useFakeTimers();
      render(
        <AvaiaSetupView
          state={unconfigured}
          onDraftChange={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
      const input = screen.getByLabelText("pub_dress");
      expect(input).toHaveValue("");
      expect(input).toHaveAttribute("readonly");

      // "0xda-sha" carries the discriminator "d", so its Avaia "xda-shai"
      // types only what lies between "xd" and "ai".
      act(() => vi.advanceTimersByTime(AVAIA_TYPING_DELAY_MS));
      expect(input).toHaveValue("a");
      act(() => vi.advanceTimersByTime(AVAIA_TYPING_STEP_MS));
      expect(input).toHaveValue("a-");
      for (let step = 0; step < 3; step += 1) {
        act(() => vi.advanceTimersByTime(AVAIA_TYPING_STEP_MS));
      }
      expect(input).toHaveValue("a-sh");
      expect(input).not.toHaveAttribute("readonly");
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("shows the address whole to a person who asked for reduced motion", () => {
      vi.stubGlobal(
        "matchMedia",
        (query: string) => ({ matches: query.includes("reduce") }) as never,
      );
      render(
        <AvaiaSetupView
          state={unconfigured}
          onDraftChange={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
      expect(screen.getByLabelText("pub_dress")).toHaveValue("a-sh");
    });
  });
});
