// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  ActivationReading,
  ActivationRequestView,
  ClientActivationAccessPort,
  ClientActivationState,
} from "@nilx-one/application";

import { ClientActivationGate } from "./client-activation-gate";
import { TransferCard } from "./transfer-card";

const ID = "0123456789abcdef0123456789abcdef";

const SYNCING: ActivationRequestView = {
  id: ID,
  role: "requester",
  status: "syncing",
  fromLabel: "iPhone · Telegram",
  toLabel: "Mac · Safari",
  createdAt: 1800000000,
  deadline: 1800000700,
  progress: {
    steps: [
      { step: "confirm", state: "done" },
      { step: "sync", state: "current" },
      { step: "switch", state: "waiting" },
    ],
    percent: 78,
    totalBytes: 1048576,
    uploadedBytes: 1048576,
    deliveredBytes: 614400,
  },
};

function reading(
  state: ClientActivationState,
  mayAct: boolean,
  request: ActivationRequestView | null,
): ActivationReading {
  return {
    kind: "state",
    view: {
      state,
      active: mayAct,
      mayAct,
      clientLabel: "Mac · Safari",
      activeClientLabel: "iPhone · Telegram",
      request,
    },
  };
}

function port(first: ActivationReading): ClientActivationAccessPort & {
  readonly requestActivation: ReturnType<typeof vi.fn>;
  readonly approveActivation: ReturnType<typeof vi.fn>;
} {
  return {
    readActivationState: vi.fn(async () => first),
    requestActivation: vi.fn(async () =>
      reading("activation_pending", false, {
        ...SYNCING,
        status: "pending",
        progress: {
          ...SYNCING.progress!,
          steps: [
            { step: "confirm", state: "current" },
            { step: "sync", state: "waiting" },
            { step: "switch", state: "waiting" },
          ],
          percent: 0,
        },
      }),
    ),
    cancelActivation: vi.fn(async () => first),
    approveActivation: vi.fn(async () => first),
    declineActivation: vi.fn(async () => first),
    uploadActivationSyncPart: vi.fn(async () => first),
    downloadActivationSyncPart: vi.fn(async () => ({
      kind: "unavailable" as const,
    })),
    completeActivation: vi.fn(async () => first),
  };
}

async function renderGate(access: ClientActivationAccessPort) {
  const view = render(
    <ClientActivationGate access={access}>
      <button type="button">Walk</button>
    </ClientActivationGate>,
  );
  await act(async () => undefined);
  return view;
}

describe("TransferCard", () => {
  it("draws Core's steps, labels and percentage as given", () => {
    render(<TransferCard request={SYNCING} t={(key) => key} />);
    const steps = screen.getAllByRole("listitem");
    expect(steps.map((step) => step.dataset.state)).toEqual([
      "done",
      "current",
      "waiting",
    ]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "78",
    );
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("iPhone · Telegram")).toBeInTheDocument();
    expect(screen.getByText("Mac · Safari")).toBeInTheDocument();
  });

  it("shows a lower percentage when Core reports one", () => {
    const { rerender } = render(
      <TransferCard request={SYNCING} t={(key) => key} />,
    );
    rerender(
      <TransferCard
        request={{
          ...SYNCING,
          progress: { ...SYNCING.progress!, percent: 41 },
        }}
        t={(key) => key}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "41",
    );
  });
});

describe("ClientActivationGate", () => {
  it("leaves the game alone while Core has no state to draw", async () => {
    await renderGate(port({ kind: "unavailable" }));
    expect(screen.getByRole("button", { name: "Walk" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("freezes the game on an inactive client and asks to play here", async () => {
    const access = port(reading("active_elsewhere", false, null));
    const { container } = await renderGate(access);
    expect(
      screen.getByRole("heading", { name: "Active on iPhone · Telegram" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".client-activation__world"),
    ).toHaveAttribute("inert");
    await userEvent.click(screen.getByRole("button", { name: "Play here" }));
    expect(access.requestActivation).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("region", { name: "Moving the game" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("asks the active client to approve while the game keeps running", async () => {
    const access = port(
      reading("approval_requested", true, { ...SYNCING, status: "pending" }),
    );
    const { container } = await renderGate(access);
    const prompt = screen.getByRole("dialog", {
      name: "Mac · Safari asks to take over",
    });
    expect(
      container.querySelector(".client-activation__world"),
    ).not.toHaveAttribute("inert");
    await userEvent.click(
      within(prompt).getByRole("button", { name: "Approve" }),
    );
    expect(access.approveActivation).toHaveBeenCalledWith(ID);
  });

  it("shows a notice the person may dismiss", async () => {
    await renderGate(
      port(
        reading("activation_expired", false, {
          ...SYNCING,
          status: "expired",
        }),
      ),
    );
    expect(
      screen.getByRole("heading", { name: "The request ran out of time." }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.getByRole("heading", { name: "Active on iPhone · Telegram" }),
    ).toBeInTheDocument();
  });
});
