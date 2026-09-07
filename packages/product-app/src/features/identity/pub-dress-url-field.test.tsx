// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PubDressLabelResolutionResult } from "@nilx-one/application";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PubDressUrlField } from "./pub-dress-url-field";
import {
  createPubDressUrlViewState,
  type PubDressUrlInput,
} from "./pub-dress-url-view-model";

function renderField(
  overrides: Partial<PubDressUrlInput> = {},
  onSuffixChange = vi.fn(),
) {
  const state = createPubDressUrlViewState({
    selection: { discriminator: "d", slug: "a-sha" },
    suffix: "",
    pending: false,
    resolution: undefined,
    ...overrides,
  });
  render(<PubDressUrlField state={state} onSuffixChange={onSuffixChange} />);
  return onSuffixChange;
}

const taken: PubDressLabelResolutionResult = {
  kind: "registered",
  label: "0xda-sha",
};

describe("public address field", () => {
  it("renders nothing before the address can be derived", () => {
    const { container } = render(
      <PubDressUrlField state={{ kind: "idle" }} onSuffixChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the lowercase address without offering an edit", () => {
    renderField();

    expect(screen.getByText("0xda-sha")).toBeInTheDocument();
    expect(screen.getByText(".nilx.one")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the fold as a before and after the Bond can read", () => {
    renderField({ selection: { discriminator: "d", slug: "A-Sha" } });

    expect(screen.getByText("0xdA-Sha")).toBeInTheDocument();
    // Once in the address itself, once as the result half of the before/after.
    expect(screen.getAllByText("0xda-sha")).toHaveLength(2);
    expect(screen.getByText(/Lowercased for the address/)).toBeInTheDocument();
  });

  it("opens an editable second part once the address is taken", () => {
    renderField({ resolution: taken });

    const suffix = screen.getByRole("textbox");
    expect(suffix).toHaveAccessibleName(
      "Distinguishing part of 0xda-sha.nilx.one",
    );
    expect(screen.getByText(/Another Bond holds this address/)).toBeVisible();
  });

  it("keeps the folded stem out of the editable part", () => {
    renderField({ resolution: taken, suffix: "7412" });

    expect(screen.getByRole("textbox")).toHaveValue("7412");
    expect(screen.getByText("0xda-sha")).toBeInTheDocument();
  });

  it("folds what the Bond types into the second part", () => {
    const onSuffixChange = renderField({ resolution: taken });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: " A2 " },
    });

    expect(onSuffixChange).toHaveBeenCalledWith("a2");
  });

  it("proposes another combination on request", () => {
    const onSuffixChange = renderField({ resolution: taken });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Suggest another distinguishing part",
      }),
    );

    expect(onSuffixChange).toHaveBeenCalledWith(expect.stringMatching(/^\d+$/));
  });

  it("marks a part that cannot appear in an address", () => {
    renderField({ resolution: taken, suffix: "7-" });

    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("explains an identity that has no address form yet", () => {
    renderField({ selection: { discriminator: "0", slug: "небо" } });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByText(/this alphabet has no agreed address form/),
    ).toBeInTheDocument();
  });
});
