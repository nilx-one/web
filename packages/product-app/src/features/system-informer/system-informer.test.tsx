// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseLocale } from "../../shell/localization";
import {
  maintenanceWindow,
  SystemInformerProvider,
  systemInformerReducer,
  useSystemErrorNotices,
  useSystemInformer,
  useSystemInformerBlock,
  type SystemNotice,
} from "./system-informer";

const notice: SystemNotice = {
  id: "network",
  kind: "error",
  title: "Map unavailable",
  description: "Please try again later.",
};
beforeEach(() => {
  chooseLocale("en");
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});
function Producer({ blocked = false }: { blocked?: boolean }) {
  const { publish } = useSystemInformer();
  useSystemInformerBlock(blocked);
  return (
    <>
      <button onClick={() => publish(notice)}>Report</button>
      <button
        onClick={() =>
          publish({ ...notice, id: "other", title: "Other problem" })
        }
      >
        Other
      </button>
    </>
  );
}
function Errors({ failed }: { failed: boolean }) {
  useSystemErrorNotices(
    failed ? [{ id: "map", kind: "error", title: "Map unavailable" }] : [],
  );
  return null;
}
describe("Ping system informer", () => {
  it("leaves the problem in a dismissible toast after skip and does not replay duplicate reports", async () => {
    const user = userEvent.setup();
    render(
      <SystemInformerProvider>
        <Producer />
      </SystemInformerProvider>,
    );
    await user.click(screen.getByText("Report"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Ping");
    await user.click(screen.getByText("(skip)"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("xPing: Map unavailable")).toBeVisible();
    await user.click(screen.getByText("Report"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Dismiss: xPing: Map unavailable" }),
    );
    expect(screen.queryByText("xPing: Map unavailable")).toBeNull();
  });
  it("serializes reports, and Escape completes only the active notice", async () => {
    const user = userEvent.setup();
    render(
      <SystemInformerProvider>
        <Producer />
      </SystemInformerProvider>,
    );
    await user.click(screen.getByText("Report"));
    await user.click(screen.getByText("Other"));
    expect(
      within(screen.getByRole("dialog")).getByText("Map unavailable"),
    ).toBeVisible();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText("Other problem"),
    ).toBeVisible();
    expect(screen.getByText("xPing: Map unavailable")).toBeVisible();
  });
  it("waits for a story scene, then restores focus after closing", async () => {
    const user = userEvent.setup();
    const view = render(
      <SystemInformerProvider>
        <Producer blocked />
      </SystemInformerProvider>,
    );
    await user.click(screen.getByText("Report"));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(
      <SystemInformerProvider>
        <Producer />
      </SystemInformerProvider>,
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getByText("Understood"));
    await user.click(screen.getByText("(skip)"));
    expect(screen.getByText("Report")).toHaveFocus();
  });
  it("reports once across StrictMode and rerenders, then rearms after recovery", async () => {
    const user = userEvent.setup();
    const tree = (failed: boolean) => (
      <StrictMode>
        <SystemInformerProvider>
          <Errors failed={failed} />
        </SystemInformerProvider>
      </StrictMode>
    );
    const view = render(tree(true));
    await user.click(screen.getByText("(skip)"));
    view.rerender(tree(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(tree(false));
    view.rerender(tree(true));
    expect(screen.getByRole("dialog")).toBeVisible();
  });
  it("keeps overflow reports as text instead of launching unbounded cutscenes", () => {
    let state = {
      queue: [] as readonly SystemNotice[],
      results: [] as readonly SystemNotice[],
    };
    for (let i = 0; i < 12; i++)
      state = systemInformerReducer(state, {
        type: "publish",
        notice: { ...notice, id: String(i) },
      });
    expect(state.queue).toHaveLength(8);
    expect(state.results).toHaveLength(4);
    const finished = systemInformerReducer(state, { type: "finish", id: "0" });
    expect(systemInformerReducer(finished, { type: "finish", id: "0" })).toBe(
      finished,
    );
  });
  it("shows only a valid explicitly supplied maintenance window", () => {
    const maintenance: SystemNotice = {
      ...notice,
      kind: "maintenance",
      window: {
        startsAt: "2026-10-10T09:00:00Z",
        endsAt: "2026-10-10T10:00:00Z",
      },
    };
    expect(maintenanceWindow(maintenance, "en")).toContain("2026");
    expect(
      maintenanceWindow(
        { ...maintenance, window: { startsAt: "invalid", endsAt: "invalid" } },
        "en",
      ),
    ).toBeUndefined();
    expect(
      maintenanceWindow(
        {
          ...maintenance,
          window: { startsAt: "2026-10-11", endsAt: "2026-10-10" },
        },
        "en",
      ),
    ).toBeUndefined();
    expect(
      maintenanceWindow({ ...notice, window: maintenance.window! }, "en"),
    ).toBeUndefined();
  });
  it("renders external-looking message text literally", () => {
    function TextProducer() {
      const { publish } = useSystemInformer();
      return (
        <button
          onClick={() =>
            publish({ ...notice, description: "<img src=x onerror=alert(1)>" })
          }
        >
          Text
        </button>
      );
    }
    render(
      <SystemInformerProvider>
        <TextProducer />
      </SystemInformerProvider>,
    );
    act(() => screen.getByText("Text").click());
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    expect(screen.getByRole("dialog").querySelector("img")).toBeNull();
  });
});

it("does not describe a title-only notice with an empty paragraph", () => {
  function Producer() {
    const { publish } = useSystemInformer();
    return (
      <button
        onClick={() =>
          publish({ id: "title-only", kind: "error", title: "Problem" })
        }
      >
        Title only
      </button>
    );
  }
  render(
    <SystemInformerProvider>
      <Producer />
    </SystemInformerProvider>,
  );
  fireEvent.click(screen.getByText("Title only"));
  const dialog = screen.getByRole("dialog");
  expect(dialog).not.toHaveAttribute("aria-describedby");
  expect(
    [...dialog.querySelectorAll("p")].every((paragraph) =>
      Boolean(paragraph.textContent),
    ),
  ).toBe(true);
});

it("keeps asides separate from receipts, gates queued scenes, and clears the departure timer", () => {
  vi.useFakeTimers();
  try {
    const view = render(
      <SystemInformerProvider>
        <Producer />
      </SystemInformerProvider>,
    );
    fireEvent.click(screen.getByText("Report"));
    fireEvent.click(screen.getByText("Other"));
    fireEvent.click(screen.getByText("Understood"));
    const aside = screen.getByRole("dialog");
    expect(aside).toHaveTextContent("Muttering to himself");
    expect(aside).not.toHaveTextContent("Map unavailable");
    expect(aside).not.toHaveTextContent("Other problem");
    expect(screen.getByText("xPing: Map unavailable")).toBeVisible();
    act(() => vi.advanceTimersByTime(6499));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Muttering to himself",
    );
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("dialog")).toHaveTextContent("Other problem");
    fireEvent.click(screen.getByText("Understood"));
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    view.unmount();
    // Flush the DOM focus event task; the departure timeout must be cancelled.
    act(() => vi.advanceTimersByTime(0));
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
