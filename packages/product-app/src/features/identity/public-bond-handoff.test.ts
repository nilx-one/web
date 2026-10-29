// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  readPublicBondMapState,
  withPublicBondMapState,
  withoutPublicBondMapState,
} from "./public-bond-handoff";

describe("public Bond map hand-off", () => {
  it("carries the camera and appearance in the fragment only", () => {
    const href = withPublicBondMapState("https://0x0sky.nilx.one/", {
      camera: {
        center: [30.5630123456, 50.4265987654],
        zoom: 17.25,
        bearing: 33.33,
        pitch: 60,
      },
      appearance: "dark",
    });
    const url = new URL(href);

    expect(url.origin + url.pathname + url.search).toBe(
      "https://0x0sky.nilx.one/",
    );
    expect(readPublicBondMapState(url.hash)).toEqual({
      camera: {
        center: [30.563012, 50.426599],
        zoom: 17.25,
        bearing: 33.3,
        pitch: 60,
      },
      appearance: "dark",
    });
  });

  it.each([
    "map=1,2,3",
    "map=200,0,10,0,0",
    "map=0,0,10,0,90",
    "map=0,0,30,0,0",
    "map=a,b,c,d,e",
    "map=0,,10,0,0",
    "appearance=sepia",
  ])("reads nothing from a malformed %s", (fragment) => {
    expect(readPublicBondMapState(`#${fragment}`)).toEqual({});
  });

  it("keeps the rest of the fragment when removing the hand-off", () => {
    expect(
      withoutPublicBondMapState("#map=0,0,1,0,0&appearance=light&x=1"),
    ).toBe("x=1");
  });
});
