// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalModelDependency } from "../../shell/local-model-host";
import {
  createOutingDecider,
  DECISION_TIMEOUT_MS,
  type OutingDecisionInput,
} from "./outing-decision";
import { initialDrive } from "./outing-drive";

const input: OutingDecisionInput = {
  state: initialDrive(0),
  menu: {
    options: [
      { kind: "stay" },
      {
        kind: "target",
        target: {
          id: "private-id",
          name: "Private name",
          kind: "museum",
          anchor: [30.5, 50.4],
          meters: 300,
        },
      },
      { kind: "wander" },
    ],
  },
  context: { at: [30.5, 50.4], home: undefined, hour: 12, now: 15_000 },
  outcome: "arrived",
};
function runtime(text = "1") {
  const engine = {
    rephrase: vi.fn(async () => text),
    unload: vi.fn(async () => undefined),
  };
  const host = {
    inspect: vi.fn(async () => ({ kind: "usable" as const })),
    isCached: vi.fn(async () => true),
    describe: vi.fn(async () => ({
      bytes: 100,
      source: "mirror" as const,
      notices: [],
    })),
    open: vi.fn(async () => engine),
    remove: vi.fn(async () => undefined),
  };
  const local: LocalModelDependency = {
    host,
    catalog: [],
    defaultModelId: "local-model",
  };
  return { engine, host, decide: createOutingDecider(local, () => undefined) };
}
afterEach(() => vi.useRealTimers());

describe("a local outing decision", () => {
  it("executes inference, returns the offered target, unloads, and exposes no identity or geometry", async () => {
    const { engine, host, decide } = runtime();
    const result = await decide(input, new AbortController().signal);
    expect(result).toEqual({ source: "model", choice: input.menu.options[1] });
    expect(host.open).toHaveBeenCalledOnce();
    expect(engine.unload).toHaveBeenCalledOnce();
    const prompt = engine.rephrase.mock.calls as unknown as [
      string,
      string,
      unknown,
    ][];
    const context = JSON.parse(prompt[0]![1]);
    expect(context.previous).toBe("arrived");
    expect(context.options).toEqual([
      { index: 0, label: "stay" },
      { index: 1, label: "museum", reach: "near" },
      { index: 2, label: "wander" },
    ]);
    expect(prompt[0]![1]).not.toMatch(
      /private|30\.5|50\.4|latitude|longitude/iu,
    );
  });

  it.each([
    "-1",
    "1.5",
    "99",
    "1 then 2",
    '{"index":1}',
    "<think>go</think>1",
    "",
  ])("refuses an unoffered or malformed answer %s", async (text) => {
    const { decide, engine } = runtime(text);
    expect(await decide(input, new AbortController().signal)).toEqual({
      source: "rules",
      reason: "invalid-output",
      choice: input.menu.options[1],
    });
    expect(engine.unload).toHaveBeenCalledOnce();
  });

  it("accepts the empty think prefix without accepting free-form reasoning", async () => {
    const { decide } = runtime("<think>\n</think>\n2");
    expect((await decide(input, new AbortController().signal)).choice).toEqual({
      kind: "wander",
    });
  });

  it("does not load a model that is not cached", async () => {
    const { decide, host } = runtime();
    host.isCached.mockResolvedValue(false);
    expect((await decide(input, new AbortController().signal)).reason).toBe(
      "not-cached",
    );
    expect(host.open).not.toHaveBeenCalled();
  });

  it("keeps unreachable-at-night targets off the model's menu", async () => {
    const { decide, engine } = runtime("1");
    const target = input.menu.options[1]!;
    if (target.kind !== "target") throw new Error("fixture");
    const result = await decide(
      {
        ...input,
        menu: {
          options: [
            { kind: "stay" },
            { kind: "target", target: { ...target.target, meters: 1500 } },
          ],
        },
        context: { ...input.context, hour: 23 },
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      source: "rules",
      reason: "invalid-output",
      choice: { kind: "stay" },
    });
    expect(
      (engine.rephrase.mock.calls as unknown as [string, string][])[0]![1],
    ).not.toContain("museum");
  });

  it("does not ask a model to overrule exhaustion", async () => {
    const { decide, host } = runtime();
    expect(
      await decide(
        { ...input, state: { ...input.state, energy: 0.1 } },
        new AbortController().signal,
      ),
    ).toMatchObject({
      choice: { kind: "stay" },
      source: "rules",
      reason: "rest",
    });
    expect(host.open).not.toHaveBeenCalled();
  });

  it("times out a stuck decode, unloads it, and refuses overlapping engines", async () => {
    vi.useFakeTimers();
    const { decide, engine, host } = runtime();
    let release!: (value: string) => void;
    engine.rephrase.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = decide(input, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(DECISION_TIMEOUT_MS);
    expect((await first).reason).toBe("timeout");
    expect(engine.unload).toHaveBeenCalledOnce();
    expect((await decide(input, new AbortController().signal)).reason).toBe(
      "busy",
    );
    expect(host.open).toHaveBeenCalledOnce();
    release("1");
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.unload).toHaveBeenCalledOnce();
  });

  it("discards and unloads a late load after spectating ended", async () => {
    vi.useFakeTimers();
    const { decide, engine, host } = runtime();
    let release!: (value: typeof engine) => void;
    host.open.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = decide(input, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await pending).reason).toBe("cancelled");
    release(engine);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.rephrase).not.toHaveBeenCalled();
    expect(engine.unload).toHaveBeenCalledOnce();
  });

  it("recovers from a failed engine on the next decision", async () => {
    const { decide, engine } = runtime();
    engine.rephrase.mockRejectedValueOnce(new Error("GPU lost"));
    expect((await decide(input, new AbortController().signal)).reason).toBe(
      "error",
    );
    expect((await decide(input, new AbortController().signal)).source).toBe(
      "model",
    );
    expect(engine.unload).toHaveBeenCalledTimes(2);
  });
});
