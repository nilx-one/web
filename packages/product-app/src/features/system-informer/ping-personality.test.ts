// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { expect, it } from "vitest";
import { createPingAsidePicker, PING_ASIDES } from "./ping-personality";

it("exhausts every aside before repeating and avoids repeats across bag boundaries", () => {
  for (const random of [() => 0, () => 0.999, Math.random]) {
    const pick = createPingAsidePicker(random);
    let previous: string | undefined;
    for (let round = 0; round < 20; round++) {
      const cycle = [];
      for (let i = 0; i < PING_ASIDES.length; i++) {
        const line = pick();
        expect(line).not.toBe(previous);
        previous = line;
        cycle.push(line);
      }
      expect(new Set(cycle)).toEqual(new Set(PING_ASIDES));
    }
  }
});
