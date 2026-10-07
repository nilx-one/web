// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvaiaLifeAnswer, AvaiaLifeCommand } from "@nilx-one/application";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  e7,
  LIFE_EVERY_MS,
  useAvaiaLife,
  type LifeBody,
} from "./use-avaia-life";

const HOME = { longitude: 30.5234, latitude: 50.4501 };

function lifeCore(answer?: (command: AvaiaLifeCommand) => AvaiaLifeAnswer) {
  const seen: { state: string; command: AvaiaLifeCommand }[] = [];
  let energy = 10_000;
  const applyAvaiaLife = vi.fn(
    async (
      state: string,
      _owner: string,
      _subject: string,
      command: AvaiaLifeCommand,
    ): Promise<AvaiaLifeAnswer> => {
      seen.push({ state, command });
      if (answer !== undefined) return answer(command);
      if (command.op === "observe") energy -= Number(command.elapsed_ms) / 1000;
      return {
        ok: true,
        state: `{"energy":${energy}}`,
        intent: energy <= 3_000 ? "return_home" : "explore",
        energy,
        hunger: 0,
        home: HOME,
      };
    },
  );
  return { core: { applyAvaiaLife }, seen };
}

const walking: LifeBody = { point: HOME, motion: "walking" };

function render(
  core: ReturnType<typeof lifeCore>["core"] | undefined,
  active = true,
) {
  return renderHook(
    ({ on }: { on: boolean }) =>
      useAvaiaLife({
        core,
        owner: "0x0sky",
        subject: "x0skai",
        active: on,
        body: () => walking,
        home: HOME,
      }),
    { initialProps: { on: active } },
  );
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Avaia life on this device", () => {
  it("begins with home, then reports where the body is and that it walks", async () => {
    const { core, seen } = lifeCore();
    const { result } = render(core);
    await advance(0);
    expect(seen[0]).toEqual({
      state: "",
      command: { op: "initialize", home: e7(HOME), position: e7(HOME) },
    });
    expect(result.current).toEqual({
      intent: "explore",
      energy: 10_000,
      home: HOME,
    });
    await advance(LIFE_EVERY_MS);
    expect(seen[1]).toEqual({
      state: '{"energy":10000}',
      command: {
        op: "observe",
        elapsed_ms: String(LIFE_EVERY_MS),
        position: e7(HOME),
        motion: "walking",
      },
    });
    expect(
      window.localStorage.getItem("nilx-one.avaia.life.v1.0x0sky.x0skai"),
    ).toBe('{"energy":9990}');
  });

  it("counts only time at the wheel, never the time away", async () => {
    const { core, seen } = lifeCore();
    const { rerender } = render(core);
    await advance(LIFE_EVERY_MS * 2);
    rerender({ on: false });
    await advance(60 * 60 * 1000);
    const away = seen.length;
    rerender({ on: true });
    await advance(LIFE_EVERY_MS);
    const back = seen.slice(away).map((entry) => entry.command);
    expect(back).toEqual([
      expect.objectContaining({ op: "observe", elapsed_ms: "0" }),
      expect.objectContaining({
        op: "observe",
        elapsed_ms: String(LIFE_EVERY_MS),
      }),
    ]);
  });

  it("says what its needs ask once they turn", async () => {
    const { core } = lifeCore();
    const { result } = render(core);
    await advance(0);
    for (let i = 0; i < 7_000 / (LIFE_EVERY_MS / 1000); i++) {
      await advance(LIFE_EVERY_MS);
    }
    expect(result.current?.intent).toBe("return_home");
  });

  it("starts again when Core cannot read what was kept", async () => {
    window.localStorage.setItem(
      "nilx-one.avaia.life.v1.0x0sky.x0skai",
      '{"broken":true}',
    );
    const { core, seen } = lifeCore(() => ({
      ok: false,
      error: "invalid_state",
    }));
    render(core);
    await advance(0);
    expect(seen[0]!.command.op).toBe("observe");
    await advance(LIFE_EVERY_MS);
    expect(seen[1]).toMatchObject({ state: "", command: { op: "initialize" } });
  });

  it("is nothing without Core's life", async () => {
    const { result } = render(undefined);
    await advance(LIFE_EVERY_MS);
    expect(result.current).toBeUndefined();
  });

  it("writes a point the way Core reads it", () => {
    expect(e7({ longitude: 30.5234, latitude: -0.00000001 })).toEqual({
      longitude_e7: "305234000",
      latitude_e7: "0",
    });
  });
});
