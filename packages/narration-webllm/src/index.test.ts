// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellEvidence,
  NarrationAdapter,
  NarrationFragment,
} from "@nilx-one/narration-contract";
import { describe, expect, it, vi } from "vitest";

import type { DeviceVerdict } from "./device";
import {
  createWebLlmNarrationAdapter,
  type LoadProgress,
  type LocalEngine,
  type WebLlmRuntimeHost,
} from "./index";

const CELL = "891fb46622fffff";
const FROM = 1_767_225_600_000;

/**
 * Stands in for the deterministic adapter. It is written out rather than imported so this
 * package keeps importing nothing but the contract, which is what the architecture test
 * enforces — and so these expectations state the sentences plainly.
 */
const base: NarrationAdapter = {
  id: "deterministic-templates",
  capability: () =>
    Promise.resolve({
      kind: "ready",
      adapter: "deterministic-templates",
    } as const),
  narrate: (evidence) =>
    Promise.resolve(
      [...evidence]
        .sort((left, right) => left.from - right.from)
        .map((record) => ({
          cell: record.cell,
          at: record.from,
          text:
            record.to === null
              ? "00:00 — ще тут."
              : record.from === FROM
                ? "00:00–00:12 — 12 хвилин."
                : "01:00–01:01 — 1 хвилина.",
        })),
    ),
};

function visit(overrides: Partial<CellEvidence> = {}): CellEvidence {
  return {
    cell: CELL,
    from: FROM,
    to: FROM + 12 * 60_000,
    kind: "visit",
    ...overrides,
  };
}

class FakeHost implements WebLlmRuntimeHost {
  public verdict: DeviceVerdict = { kind: "usable", shaderF16: true };
  public cached = false;
  public opened = 0;
  public unloaded = 0;
  public said: string | ((source: string) => string) = "Був тут 12 хвилин.";
  public failOpen = false;
  public prompts: string[] = [];

  public inspect(): Promise<DeviceVerdict> {
    return Promise.resolve(this.verdict);
  }

  public isCached(): Promise<boolean> {
    return Promise.resolve(this.cached);
  }

  public open(
    _modelId: string,
    onProgress: (progress: LoadProgress) => void,
  ): Promise<LocalEngine> {
    if (this.failOpen) {
      return Promise.reject(new Error("device lost"));
    }
    this.opened += 1;
    onProgress({ ratio: 0.5, text: "halfway" });

    return Promise.resolve({
      rephrase: (_system: string, user: string): Promise<string> => {
        this.prompts.push(user);
        return Promise.resolve(
          typeof this.said === "function" ? this.said(user) : this.said,
        );
      },
      unload: (): Promise<void> => {
        this.unloaded += 1;
        return Promise.resolve();
      },
    });
  }
}

function adapterFor(host: WebLlmRuntimeHost, options = {}): NarrationAdapter {
  return createWebLlmNarrationAdapter({ base, host, ...options });
}

async function textsOf(
  adapter: NarrationAdapter,
  evidence: readonly CellEvidence[],
): Promise<readonly string[]> {
  const fragments = await adapter.narrate(evidence);
  return fragments.map((fragment: NarrationFragment) => fragment.text);
}

describe("local narration availability", () => {
  it("is ready on a device that clears the runtime floors", async () => {
    await expect(adapterFor(new FakeHost()).capability()).resolves.toEqual({
      kind: "ready",
      adapter: "webllm-local",
    });
  });

  it("reports an unsupported surface rather than attempting a load", async () => {
    const host = new FakeHost();
    host.verdict = {
      kind: "below_runtime_floor",
      limit: "maxStorageBuffersPerShaderStage",
      granted: 8,
    };

    await expect(adapterFor(host).capability()).resolves.toEqual({
      kind: "unavailable",
      adapter: "webllm-local",
      reason: "surface_unsupported",
    });
    expect(host.opened).toBe(0);
  });

  it("asks nothing of the device until narration is requested", async () => {
    const host = new FakeHost();
    const inspect = vi.spyOn(host, "inspect");

    adapterFor(host);

    expect(inspect).not.toHaveBeenCalled();
    expect(host.opened).toBe(0);
  });
});

describe("one bounded pass", () => {
  it("rephrases the deterministic sentence and keeps its cell and moment", async () => {
    const host = new FakeHost();
    host.said = "Провів тут 12 хвилин.";

    const [fragment] = await adapterFor(host).narrate([visit()]);

    expect(fragment).toEqual({
      cell: CELL,
      at: FROM,
      text: "Провів тут 12 хвилин.",
    });
    expect(host.prompts).toEqual(["00:00–00:12 — 12 хвилин."]);
  });

  it("unloads afterwards, because nothing here stays resident", async () => {
    const host = new FakeHost();

    await adapterFor(host).narrate([visit()]);

    expect(host.opened).toBe(1);
    expect(host.unloaded).toBe(1);
  });

  it("loads once for the whole batch", async () => {
    const host = new FakeHost();
    const evidence = [
      visit(),
      visit({ from: FROM + 3_600_000, to: FROM + 3_660_000 }),
    ];

    await adapterFor(host).narrate(evidence);

    expect(host.opened).toBe(1);
    expect(host.prompts).toHaveLength(2);
  });

  it("keeps the deterministic sentence beyond the record bound", async () => {
    const host = new FakeHost();
    host.said = "Переказано.";
    const evidence = [
      visit(),
      visit({ from: FROM + 3_600_000, to: FROM + 3_660_000 }),
    ];

    const texts = await textsOf(adapterFor(host, { maxRecords: 1 }), evidence);

    expect(texts).toEqual(["Переказано.", "01:00–01:01 — 1 хвилина."]);
  });
});

describe("the model may not become a source of facts", () => {
  it("discards a sentence carrying a number its evidence never held", async () => {
    const host = new FakeHost();
    host.said = "Був тут 47 хвилин разом із трьома друзями.";

    await expect(textsOf(adapterFor(host), [visit()])).resolves.toEqual([
      "00:00–00:12 — 12 хвилин.",
    ]);
  });

  it("discards an empty sentence and one that runs away", async () => {
    const host = new FakeHost();
    host.said = "";
    await expect(textsOf(adapterFor(host), [visit()])).resolves.toEqual([
      "00:00–00:12 — 12 хвилин.",
    ]);

    host.said = "дуже ".repeat(60);
    await expect(textsOf(adapterFor(host), [visit()])).resolves.toEqual([
      "00:00–00:12 — 12 хвилин.",
    ]);
  });

  it("keeps a rephrasing that only reuses the numbers it was given", async () => {
    const host = new FakeHost();
    host.said = "12 хвилин на цьому місці.";

    await expect(textsOf(adapterFor(host), [visit()])).resolves.toEqual([
      "12 хвилин на цьому місці.",
    ]);
  });

  it("does not let an open visit acquire an ending", async () => {
    const host = new FakeHost();
    host.said = "Був тут до 00:30.";

    await expect(
      textsOf(adapterFor(host), [visit({ to: null })]),
    ).resolves.toEqual(["00:00 — ще тут."]);
  });
});

describe("failure keeps narration at Phase 2", () => {
  it("returns deterministic sentences when the surface cannot run a model", async () => {
    const host = new FakeHost();
    host.verdict = { kind: "webgpu_missing" };

    await expect(textsOf(adapterFor(host), [visit()])).resolves.toEqual([
      "00:00–00:12 — 12 хвилин.",
    ]);
    expect(host.opened).toBe(0);
  });

  it("returns deterministic sentences when the model fails to load", async () => {
    const host = new FakeHost();
    host.failOpen = true;

    await expect(textsOf(adapterFor(host), [visit()])).resolves.toEqual([
      "00:00–00:12 — 12 хвилин.",
    ]);
  });

  it("returns deterministic sentences when generation throws mid-pass", async () => {
    const host = new FakeHost();
    host.said = () => {
      throw new Error("engine lost the device");
    };

    await expect(textsOf(adapterFor(host), [visit()])).resolves.toEqual([
      "00:00–00:12 — 12 хвилин.",
    ]);
    // A failed pass still releases the engine.
    expect(host.unloaded).toBe(1);
  });

  it("narrates nothing for no evidence, without opening an engine", async () => {
    const host = new FakeHost();

    await expect(adapterFor(host).narrate([])).resolves.toEqual([]);
    expect(host.opened).toBe(0);
  });
});
