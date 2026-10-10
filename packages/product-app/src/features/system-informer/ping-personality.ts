// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export const PING_DEPARTURE_MS = 6500;
export const PING_ASIDES = [
  "system.ping.aside.module",
  "system.ping.aside.tape",
  "system.ping.aside.screw",
  "system.ping.aside.rotor",
  "system.ping.aside.warranty",
  "system.ping.aside.paint",
  "system.ping.aside.manual",
  "system.ping.aside.smoke",
] as const;

/** Presentation-only shuffle bag. Deliberately accepts no notice or user data. */
export function createPingAsidePicker(random: () => number = Math.random) {
  let bag: (typeof PING_ASIDES)[number][] = [];
  let previous: (typeof PING_ASIDES)[number] | undefined;
  return () => {
    if (bag.length === 0) {
      bag = [...PING_ASIDES];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      if (bag[bag.length - 1] === previous)
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[0]!];
    }
    previous = bag.pop()!;
    return previous;
  };
}
