// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  consumePublicBondMapState,
  publicAvaiaPath,
  publicBondScreen,
} from "./public-bond-navigation";

describe("public Bond screens", () => {
  it("opens the Bond at its root and its Avaia under the Avaia's address", () => {
    expect(publicBondScreen("/", "x0skai")).toBe("bond");
    expect(publicBondScreen("/x0skai", "x0skai")).toBe("avaia");
    expect(publicBondScreen("/x0skai/", "x0skai")).toBe("avaia");
  });

  it("keeps a case-sensitive or Unicode Avaia address exact", () => {
    const avaia = "x0Скай";
    expect(publicBondScreen(publicAvaiaPath(avaia), avaia)).toBe("avaia");
    expect(publicBondScreen("/x0SKAI", "x0skai")).toBe("missing");
  });

  it("never resolves another path to the Bond", () => {
    expect(publicBondScreen("/someone", "x0skai")).toBe("missing");
    expect(publicBondScreen("/x0skai", undefined)).toBe("missing");
    expect(publicBondScreen("/%E0%A4%A", "x0skai")).toBe("missing");
  });
});

describe("consuming the hand-off", () => {
  function browser(href: string, state: unknown = null) {
    const location = new URL(href);
    const history = {
      state,
      replaceState(next: unknown, _title: string, url: string) {
        history.state = next;
        const resolved = new URL(url, location.href);
        location.hash = resolved.hash;
        location.pathname = resolved.pathname;
      },
    };
    return {
      location: location as unknown as Location,
      history: history as unknown as History,
    };
  }

  it("reads the fragment, cleans the address and keeps it for a reload", () => {
    const first = browser(
      "https://0x0sky.nilx.one/x0skai#map=30.5,50.4,16,10,45&appearance=dark",
    );

    const state = consumePublicBondMapState(first);

    expect(state).toEqual({
      camera: { center: [30.5, 50.4], zoom: 16, bearing: 10, pitch: 45 },
      appearance: "dark",
    });
    expect(first.location.hash).toBe("");
    expect(first.location.pathname).toBe("/x0skai");

    // A reload has no fragment any more, but the entry still remembers.
    const reload = browser(
      "https://0x0sky.nilx.one/x0skai",
      first.history.state,
    );
    expect(consumePublicBondMapState(reload)).toEqual(state);
  });

  it("hands nothing over when nothing was carried", () => {
    expect(
      consumePublicBondMapState(browser("https://0x0sky.nilx.one/")),
    ).toEqual({});
  });
});
