// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chooseLocale } from "../../shell/localization";
import { FlyoverControls, FLYOVER_SWIPE_PIXELS } from "./flyover-controls";

beforeEach(() => chooseLocale("en"));
afterEach(() => chooseLocale("auto"));

function setup() {
  const onSteer = vi.fn();
  const onLeave = vi.fn();
  const view = render(<FlyoverControls onSteer={onSteer} onLeave={onLeave} />);
  const surface = view.container.querySelector(".flyover__surface")!;
  return { onSteer, onLeave, surface };
}

describe("FlyoverControls", () => {
  it("steps on the buttons and leaves on request", () => {
    const { onSteer, onLeave } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Step left" }));
    fireEvent.click(screen.getByRole("button", { name: "Step right" }));
    expect(onSteer.mock.calls).toEqual([[-1], [1]]);
    fireEvent.click(screen.getByRole("button", { name: "Leave the flight" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("steps on a sideways swipe, not on a tap or an upward one", () => {
    const { onSteer, surface } = setup();
    const swipe = (dx: number, dy: number) => {
      fireEvent.pointerDown(surface, { clientX: 200, clientY: 300 });
      fireEvent.pointerUp(surface, { clientX: 200 + dx, clientY: 300 + dy });
    };
    swipe(-(FLYOVER_SWIPE_PIXELS + 10), 5);
    swipe(FLYOVER_SWIPE_PIXELS + 10, -5);
    swipe(4, 2);
    swipe(40, -120);
    expect(onSteer.mock.calls).toEqual([[-1], [1]]);
  });

  it("puts the activity row lowest, under the steering", () => {
    const view = render(
      <FlyoverControls
        onSteer={vi.fn()}
        onLeave={vi.fn()}
        activities={<p>150 m to 0xda-market Golden Gate</p>}
      />,
    );
    const bottom = view.container.querySelector(".flyover__bottom")!;
    expect([...bottom.children].map((child) => child.className)).toEqual([
      "flyover__steer",
      "flyover__activities",
    ]);
    expect(bottom.lastElementChild).toHaveTextContent(
      "150 m to 0xda-market Golden Gate",
    );
  });
});
