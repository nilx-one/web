// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AMBIENT_ANIMAL_CLIPS,
  AMBIENT_ANIMAL_KINDS,
  type AmbientAnimalClipId,
  type AmbientAnimalHandle,
  type AmbientAnimalKind,
} from "./index";

/** Types its argument as a handle, so a wrong kind or clip is a type error. */
const handle = (value: AmbientAnimalHandle): AmbientAnimalHandle => value;

const common = {
  id: "a1",
  lngLat: [30.5, 50.4],
  bearingDeg: 0,
  clipPhase: 0,
  visible: true,
} as const;

describe("an ambient animal's handle", () => {
  it("admits the clips its own kind carries", () => {
    expect(handle({ ...common, kind: "dog", clipId: "walk" }).kind).toBe("dog");
    expect(
      handle({ ...common, kind: "eagle", clipId: "fly", heightMeters: 3.2 })
        .clipId,
    ).toBe("fly");
    expect(handle({ ...common, kind: "squirrel", clipId: "eat" }).clipId).toBe(
      "eat",
    );
  });

  it("refuses a clip its kind does not carry", () => {
    // prettier-ignore
    // @ts-expect-error a dog has no `bite` clip
    handle({ ...common, kind: "dog", clipId: "bite" });
    // prettier-ignore
    // @ts-expect-error an eagle has no `walk` clip
    handle({ ...common, kind: "eagle", clipId: "walk" });
    // prettier-ignore
    // @ts-expect-error a piranha does not fly
    handle({ ...common, kind: "piranha", clipId: "fly" });
    // prettier-ignore
    // @ts-expect-error a squirrel runs, it does not walk
    handle({ ...common, kind: "squirrel", clipId: "walk" });
  });

  it("refuses a kind the city does not have", () => {
    // prettier-ignore
    // @ts-expect-error there is no `horse` in the animal pack
    handle({ ...common, kind: "horse", clipId: "walk" });
  });

  it("is a union over exactly the kinds and clips the catalogue lists", () => {
    expectTypeOf<AmbientAnimalKind>().toEqualTypeOf<
      "dog" | "cat" | "eagle" | "piranha" | "squirrel"
    >();
    expectTypeOf<AmbientAnimalClipId>().toEqualTypeOf<
      "idle" | "walk" | "fly" | "swim" | "bite" | "run" | "eat"
    >();
    expectTypeOf<
      AmbientAnimalHandle["kind"]
    >().toEqualTypeOf<AmbientAnimalKind>();
  });

  it("has a catalogue entry for every kind, with no extras", () => {
    expect(Object.keys(AMBIENT_ANIMAL_CLIPS).sort()).toEqual(
      [...AMBIENT_ANIMAL_KINDS].sort(),
    );
  });
});
