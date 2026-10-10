// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer } from "@nilx-one/map-contract";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { chooseLocale } from "../../shell/localization";
import { SystemInformerProvider, useSystemInformer } from "./system-informer";
import { useSystemDroneScene } from "./use-system-drone-scene";

function World({
  renderer,
  ready = true,
  longitude = 30.5,
}: {
  renderer: MapRenderer;
  ready?: boolean;
  longitude?: number;
}) {
  useSystemDroneScene(renderer, { longitude, latitude: 50.4 }, ready);
  const { publish } = useSystemInformer();
  return (
    <button
      onClick={() =>
        publish({ id: "problem", kind: "error", title: "Problem" })
      }
    >
      Report
    </button>
  );
}
it("returns the camera, removes the prop and stops animation on skip without moving a Bond", () => {
  chooseLocale("en");
  const base = { center: [30.5, 50.4], zoom: 16, bearing: 20, pitch: 40 };
  const renderer = {
    systemDrone: { upsert: vi.fn(), remove: vi.fn() },
    getCamera: () => base,
    setCamera: vi.fn(),
    setObservedPosition: vi.fn(),
  } as unknown as MapRenderer;
  const cancel = vi.spyOn(window, "cancelAnimationFrame");
  const view = render(
    <SystemInformerProvider>
      <World renderer={renderer} />
    </SystemInformerProvider>,
  );
  fireEvent.click(screen.getByText("Report"));
  expect(renderer.systemDrone?.upsert).toHaveBeenCalled();
  expect(renderer.setCamera).toHaveBeenCalledTimes(1);
  view.rerender(
    <SystemInformerProvider>
      <World renderer={renderer} longitude={30.6} />
    </SystemInformerProvider>,
  );
  expect(renderer.setCamera).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("(skip)"));
  expect(renderer.systemDrone?.remove).toHaveBeenCalledWith("system:xPing");
  expect(renderer.setCamera).toHaveBeenLastCalledWith(
    base,
    expect.objectContaining({ motion: "eased" }),
  );
  expect(renderer.setObservedPosition).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalled();
  cancel.mockRestore();
});
describe("text fallback", () => {
  it.each([false, true])(
    "survives unavailable/throwing renderer (ready=%s)",
    (ready) => {
      chooseLocale("en");
      const renderer = {
        systemDrone: {
          upsert: vi.fn(() => {
            throw new Error("lost context");
          }),
          remove: vi.fn(),
        },
        getCamera: () => ({ center: [0, 0], zoom: 1, bearing: 0, pitch: 0 }),
        setCamera: vi.fn(),
      } as unknown as MapRenderer;
      render(
        <SystemInformerProvider>
          <World renderer={renderer} ready={ready} />
        </SystemInformerProvider>,
      );
      fireEvent.click(screen.getByText("Report"));
      expect(screen.getByRole("dialog")).not.toHaveAttribute("data-world");
      fireEvent.click(screen.getByText("(skip)"));
      expect(screen.getByText("xPing: Problem")).toBeVisible();
    },
  );
});

it("keeps the message available if even camera inspection fails", () => {
  chooseLocale("en");
  const renderer = {
    systemDrone: { upsert: vi.fn(), remove: vi.fn() },
    getCamera: () => {
      throw new Error("lost renderer");
    },
    setCamera: vi.fn(),
  } as unknown as MapRenderer;
  render(
    <SystemInformerProvider>
      <World renderer={renderer} />
    </SystemInformerProvider>,
  );
  fireEvent.click(screen.getByText("Report"));
  expect(screen.getByRole("dialog")).not.toHaveAttribute("data-world");
  fireEvent.click(screen.getByText("(skip)"));
  expect(screen.getByText("xPing: Problem")).toBeVisible();
});

it.each([false, true])(
  "restores the captured padding with reducedMotion=%s",
  (reduced) => {
    chooseLocale("en");
    vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    const base = { center: [30.5, 50.4], zoom: 16, bearing: 20, pitch: 40 };
    const padding = { top: 30, right: 12, bottom: 240, left: 8 };
    const renderer = {
      systemDrone: { upsert: vi.fn(() => true), remove: vi.fn() },
      getCamera: () => base,
      getCameraPadding: () => ({ ...padding }),
      setCamera: vi.fn(),
    } as unknown as MapRenderer;
    const view = render(
      <SystemInformerProvider>
        <World renderer={renderer} />
      </SystemInformerProvider>,
    );
    fireEvent.click(screen.getByText("Report"));
    fireEvent.click(screen.getByText("(skip)"));
    expect(renderer.setCamera).toHaveBeenLastCalledWith(base, {
      motion: reduced ? "immediate" : "eased",
      durationMs: 600,
      padding,
    });
    view.unmount();
    vi.unstubAllGlobals();
  },
);
