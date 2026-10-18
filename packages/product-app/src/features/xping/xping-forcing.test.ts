// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  XpingEngineAccessPort,
  XpingEngineRead,
  XpingEngineResult,
} from "@nilx-one/application";
import { describe, expect, it, vi } from "vitest";

import { createXpingForcing } from "./xping-forcing";

function read(energy: number, margin = 2_000, broken = false): XpingEngineRead {
  return {
    state: { energy_permille: energy, at_ms: "0" },
    view: {
      energyPermille: energy,
      smokePermille: 1000 - energy,
      broken,
      emptyMarginMs: margin,
      fullAtMs: undefined,
      repairSeeds: 0,
    },
    nowMs: 0,
  };
}

function service(answers: XpingEngineResult[]) {
  return {
    readXpingEngine: vi.fn(),
    forceXpingEngine: vi.fn(async () => answers.shift()!),
    repairXpingEngine: vi.fn(),
  } satisfies XpingEngineAccessPort;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createXpingForcing", () => {
  it("empties as it is held and tells the service a second at a time", async () => {
    const port = service([{ kind: "read", ...read(450) }]);
    const forcing = createXpingForcing(port, read(500), vi.fn());
    expect(forcing.energy()).toBeCloseTo(0.5);
    expect(forcing.wear()).toBeCloseTo(0.5);
    forcing.spent(600);
    expect(port.forceXpingEngine).not.toHaveBeenCalled();
    expect(forcing.energy()).toBeCloseTo(0.48);
    forcing.spent(400);
    expect(port.forceXpingEngine).toHaveBeenCalledWith(1000);
    await settle();
    // The service's answer is what counts.
    expect(forcing.energy()).toBeCloseTo(0.45);
  });

  it("tells the service at once when the margin on empty runs out, and calls the flight off", async () => {
    const onBroken = vi.fn();
    const port = service([
      { kind: "read", ...read(0, 200) },
      { kind: "read", ...read(0, 0, true) },
    ]);
    const forcing = createXpingForcing(port, read(0, 2_000), onBroken);
    forcing.spent(900);
    expect(port.forceXpingEngine).not.toHaveBeenCalled();
    forcing.spent(900);
    expect(port.forceXpingEngine).toHaveBeenLastCalledWith(1800);
    // Past the margin the rest goes at once, not a second later.
    forcing.spent(200);
    await settle();
    expect(port.forceXpingEngine).toHaveBeenLastCalledWith(200);
    await settle();
    expect(onBroken).toHaveBeenCalledOnce();
    expect(forcing.broken()).toBe(true);
    expect(forcing.allowed()).toBe(false);
    expect(forcing.wear()).toBe(1);
  });

  it("never forces a broken engine and treats a broken refusal as a breakdown", async () => {
    expect(
      createXpingForcing(service([]), read(0, 0, true), vi.fn()).allowed(),
    ).toBe(false);
    const onBroken = vi.fn();
    const port = service([{ kind: "rejected", reason: "broken" }]);
    const forcing = createXpingForcing(port, read(1000), onBroken);
    forcing.spent(1000);
    await settle();
    expect(onBroken).toHaveBeenCalledOnce();
  });

  it("tells what is left when the flight ends", () => {
    const port = service([{ kind: "read", ...read(990) }]);
    const forcing = createXpingForcing(port, read(1000), vi.fn());
    forcing.spent(300);
    forcing.close();
    expect(port.forceXpingEngine).toHaveBeenCalledWith(300);
  });
});
