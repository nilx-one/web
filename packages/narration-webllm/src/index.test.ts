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
  GENERATION_PROFILES,
  NARRATION_MODEL_ID,
  type LoadProgress,
  type LocalEngine,
  type RephraseOptions,
  type WebLlmRuntimeHost,
} from "./index";

const LLAMA = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const SMOLLM2 = "SmolLM2-360M-Instruct-q4f16_1-MLC";

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
  public verdict: DeviceVerdict = { kind: "usable" };
  /** Per-entry verdicts, where one entry is refused and another is not. */
  public verdicts: Readonly<Record<string, DeviceVerdict>> = {};
  public openedIds: string[] = [];
  public generation: RephraseOptions[] = [];
  public cached = false;
  public opened = 0;
  public unloaded = 0;
  public removed = 0;
  public said: string | ((source: string) => string) = "Був тут 12 хвилин.";
  public failOpen = false;
  public prompts: string[] = [];

  public inspect(modelId: string): Promise<DeviceVerdict> {
    return Promise.resolve(this.verdicts[modelId] ?? this.verdict);
  }

  public isCached(): Promise<boolean> {
    return Promise.resolve(this.cached);
  }

  public remove(): Promise<void> {
    this.removed += 1;
    this.cached = false;
    return Promise.resolve();
  }

  public open(
    modelId: string,
    onProgress: (progress: LoadProgress) => void,
  ): Promise<LocalEngine> {
    if (this.failOpen) {
      return Promise.reject(new Error("device lost"));
    }
    this.opened += 1;
    this.openedIds.push(modelId);
    onProgress({ ratio: 0.5, text: "halfway" });

    return Promise.resolve({
      rephrase: (
        _system: string,
        user: string,
        options: RephraseOptions,
      ): Promise<string> => {
        this.prompts.push(user);
        this.generation.push(options);
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
      producedBy: {
        adapter: "webllm-local",
        modelId: NARRATION_MODEL_ID,
        licence: "apache-2.0",
      },
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

describe("the entry that runs is the owner's choice, read when narration runs", () => {
  it("opens the default when nothing was chosen", async () => {
    const host = new FakeHost();

    await adapterFor(host).narrate([visit()]);

    expect(host.openedIds).toEqual([NARRATION_MODEL_ID]);
  });

  it("opens whatever the choice names at the moment of narration, not at composition", async () => {
    const host = new FakeHost();
    let choice: string | undefined = SMOLLM2;
    const adapter = adapterFor(host, { modelId: () => choice });

    choice = LLAMA;
    await adapter.narrate([visit()]);

    expect(host.openedIds).toEqual([LLAMA]);
  });

  it("falls back to the default when the device refuses the chosen entry", async () => {
    const host = new FakeHost();
    host.verdicts = {
      [LLAMA]: { kind: "over_budget", requiredMb: 879.04, budgetMb: 512 },
    };

    await adapterFor(host, { modelId: LLAMA }).narrate([visit()]);

    expect(host.openedIds).toEqual([NARRATION_MODEL_ID]);
  });

  it("treats a choice the catalog no longer serves as the default", async () => {
    const host = new FakeHost();

    await adapterFor(host, { modelId: "gemma3-1b-it-q4f16_1-MLC" }).narrate([
      visit(),
    ]);

    expect(host.openedIds).toEqual([NARRATION_MODEL_ID]);
  });

  it("narrates deterministically when the device admits neither", async () => {
    const host = new FakeHost();
    host.verdicts = {
      [LLAMA]: { kind: "over_budget", requiredMb: 879.04, budgetMb: 512 },
      [NARRATION_MODEL_ID]: {
        kind: "over_budget",
        requiredMb: 1403.34,
        budgetMb: 512,
      },
    };

    await expect(
      textsOf(adapterFor(host, { modelId: LLAMA }), [visit()]),
    ).resolves.toEqual(["00:00–00:12 — 12 хвилин."]);
    expect(host.opened).toBe(0);
    await expect(
      adapterFor(host, { modelId: LLAMA }).capability(),
    ).resolves.toEqual({
      kind: "unavailable",
      adapter: "webllm-local",
      reason: "surface_unsupported",
    });
  });

  it("asks each family with its own profile", async () => {
    const host = new FakeHost();

    await adapterFor(host, { modelId: SMOLLM2 }).narrate([visit()]);

    expect(host.generation).toEqual([
      {
        maxNewTokens: GENERATION_PROFILES.smollm2.maxNewTokens,
        temperature: GENERATION_PROFILES.smollm2.temperature,
        topP: GENERATION_PROFILES.smollm2.topP,
      },
    ]);
  });
});

describe("what a model wrote is marked with who wrote it", () => {
  it("marks Llama output with its licence, which reaches past the device", async () => {
    const host = new FakeHost();
    host.said = "Провів тут 12 хвилин.";

    const [fragment] = await adapterFor(host, { modelId: LLAMA }).narrate([
      visit(),
    ]);

    expect(fragment?.producedBy).toEqual({
      adapter: "webllm-local",
      modelId: LLAMA,
      licence: "llama3.2",
    });
  });

  it("leaves a refused rephrasing unmarked, because no model wrote what is shown", async () => {
    const host = new FakeHost();
    host.said = "Був тут 47 хвилин.";

    const [fragment] = await adapterFor(host, { modelId: LLAMA }).narrate([
      visit(),
    ]);

    expect(fragment?.text).toBe("00:00–00:12 — 12 хвилин.");
    expect(fragment?.producedBy).toBeUndefined();
  });

  it("strips the empty thinking block the runtime writes before every reply", async () => {
    const host = new FakeHost();
    host.said = "<think>\n\n</think>\n\nПровів тут 12 хвилин.";

    await expect(textsOf(adapterFor(host), [visit()])).resolves.toEqual([
      "Провів тут 12 хвилин.",
    ]);
  });

  it("refuses a sentence the token bound cut off", async () => {
    const host = new FakeHost();
    host.said = "Провів тут 12 хвилин і ця клітинка тепер";

    await expect(textsOf(adapterFor(host), [visit()])).resolves.toEqual([
      "00:00–00:12 — 12 хвилин.",
    ]);
  });
});
