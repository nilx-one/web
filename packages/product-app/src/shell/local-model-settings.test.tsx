// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LOCAL_MODEL_CHOICE_STORAGE_KEY } from "./local-model-choice";
import type {
  LocalModelCatalogEntry,
  LocalModelDescription,
  LocalModelDeviceVerdict,
  LocalModelDownloadProgress,
  LocalModelEngine,
  LocalModelHost,
} from "./local-model-host";
import { LocalModelSettings } from "./local-model-settings";

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";
const SMOLLM2 = "SmolLM2-360M-Instruct-q4f16_1-MLC";
const LLAMA = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

function entry(
  modelId: string,
  label: string,
  vramMb: number,
  overrides: Partial<LocalModelCatalogEntry> = {},
): LocalModelCatalogEntry {
  return {
    modelId,
    family: "qwen3",
    label,
    vramMb,
    licence: "apache-2.0",
    licenceName: "Apache License 2.0",
    attribution: null,
    usePolicy: null,
    notices: [`${label} by upstream, licensed under the Apache License 2.0.`],
    faithfulness: null,
    ...overrides,
  };
}

const CATALOG: readonly LocalModelCatalogEntry[] = [
  entry(MODEL_ID, "Qwen3 0.6B", 1403.34),
  entry(SMOLLM2, "SmolLM2 360M", 376.06, { family: "smollm2" }),
  entry(LLAMA, "Llama 3.2 1B", 879.04, {
    family: "llama3.2",
    licence: "llama3.2",
    licenceName: "Llama 3.2 Community License",
    attribution: "Built with Llama",
    usePolicy: "https://www.llama.com/llama3_2/use-policy",
    notices: [
      "Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.",
    ],
  }),
];

beforeEach(() => {
  window.localStorage.clear();
});

class FakeHost implements LocalModelHost {
  public verdict: LocalModelDeviceVerdict = { kind: "usable" };
  public verdicts: Readonly<Record<string, LocalModelDeviceVerdict>> = {};
  public described: string[] = [];
  public openedIds: string[] = [];
  public cached = false;
  public description: LocalModelDescription = {
    bytes: null,
    source: "upstream",
  };
  public opened = 0;
  public unloaded = 0;
  public removed = 0;
  public failOpen = false;
  /** Holds `open` until its signal aborts, as a download a person stops midway would. */
  public holdOpen = false;
  /**
   * Throws once from `isCached`, as an artifact an interrupted write left unreadable would
   * — see the device's own `@mlc-ai/web-llm` OPFS writer, which is not atomic everywhere.
   */
  public unreadableCache = false;

  public inspect(modelId: string): Promise<LocalModelDeviceVerdict> {
    return Promise.resolve(this.verdicts[modelId] ?? this.verdict);
  }

  public isCached(): Promise<boolean> {
    if (this.unreadableCache) {
      this.unreadableCache = false;
      return Promise.reject(
        new SyntaxError("JSON Parse error: Unexpected EOF"),
      );
    }
    return Promise.resolve(this.cached);
  }

  public describe(modelId: string): Promise<LocalModelDescription> {
    this.described.push(modelId);
    return Promise.resolve(this.description);
  }

  public open(
    modelId: string,
    onProgress: (progress: LocalModelDownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<LocalModelEngine> {
    this.openedIds.push(modelId);
    if (this.holdOpen) {
      onProgress({ ratio: 0.25, text: "" });
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    }
    if (this.failOpen) {
      return Promise.reject(new Error("device lost"));
    }
    this.opened += 1;
    onProgress({ ratio: 0.5, text: "halfway" });
    this.cached = true;

    return Promise.resolve({
      unload: (): Promise<void> => {
        this.unloaded += 1;
        return Promise.resolve();
      },
    });
  }

  public remove(): Promise<void> {
    this.removed += 1;
    this.cached = false;
    return Promise.resolve();
  }
}

function renderSettings(host: LocalModelHost) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LocalModelSettings
        host={host}
        catalog={CATALOG}
        defaultModelId={MODEL_ID}
      />
    </QueryClientProvider>,
  );
}

describe("a device this runtime cannot start on", () => {
  it("names the reason and offers no download", async () => {
    const host = new FakeHost();
    host.verdict = { kind: "webgpu_missing" };

    renderSettings(host);

    await waitFor(() =>
      expect(
        screen.getByText("Unavailable: this browser has no WebGPU."),
      ).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "Download now" })).toBeDisabled();
  });
});

describe("a device that has not fetched the model yet", () => {
  it("states the size and where it comes from before anything is fetched", async () => {
    const host = new FakeHost();
    host.description = { bytes: 3_000_000, source: "upstream", notices: [] };

    renderSettings(host);

    await waitFor(() =>
      expect(screen.getByText("Not downloaded yet.")).toBeVisible(),
    );
    expect(screen.getByText(/registry.*\b3 MB/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Download now" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Remove downloaded model" }),
    ).toBeDisabled();
  });

  it("says the size is unknown rather than guessing one", async () => {
    const host = new FakeHost();
    host.description = { bytes: null, source: "upstream" };

    renderSettings(host);

    await waitFor(() =>
      expect(
        screen.getByText(/size unknown until the download starts\./),
      ).toBeVisible(),
    );
  });

  it("carries a mirror's redistribution notices into the details", async () => {
    const notice = "Model weights converted and published by mlc-ai.";
    const host = new FakeHost();
    host.description = {
      bytes: 3_000_000,
      source: "mirror",
      notices: [notice],
    };

    renderSettings(host);

    await waitFor(() =>
      expect(screen.getByText(/From our own mirror/)).toBeVisible(),
    );
    fireEvent.click(screen.getByText("Redistribution notices"));
    expect(screen.getByText(notice)).toBeVisible();
  });
});

describe("downloading from Settings", () => {
  it("reports progress, then leaves the model cached and ready to remove", async () => {
    const host = new FakeHost();
    host.description = { bytes: 3_000_000, source: "upstream", notices: [] };

    renderSettings(host);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download now" }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Download now" }));

    await waitFor(() =>
      expect(
        screen.getByText("Downloaded and cached on this device."),
      ).toBeVisible(),
    );
    expect(host.opened).toBe(1);
    expect(host.unloaded).toBe(1);
    expect(
      screen.getByRole("button", { name: "Remove downloaded model" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download now" })).toBeDisabled();
  });

  it("reports failure and keeps the download offered as the retry", async () => {
    const host = new FakeHost();
    host.description = { bytes: 3_000_000, source: "upstream", notices: [] };
    host.failOpen = true;

    renderSettings(host);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download now" }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Download now" }));

    await waitFor(() => expect(screen.getByText("device lost")).toBeVisible());
    expect(screen.getByRole("button", { name: "Download now" })).toBeEnabled();
    // A failed download may still have left something behind that a status check cannot
    // read; removal stays on offer rather than depending on knowing why it failed.
    expect(
      screen.getByRole("button", { name: "Remove downloaded model" }),
    ).toBeEnabled();
  });
});

describe("cancelling a download from Settings", () => {
  it("abandons it through the host and returns without reporting a failure", async () => {
    const host = new FakeHost();
    host.description = { bytes: 3_000_000, source: "upstream", notices: [] };
    host.holdOpen = true;

    renderSettings(host);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download now" }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Download now" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Cancel download" }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));

    await waitFor(() =>
      expect(screen.getByText("Not downloaded yet.")).toBeVisible(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Download now" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Cancel download" }),
    ).toBeNull();
  });
});

describe("a cache check that cannot prove the model complete", () => {
  it("reads as absent rather than an error, and evicts what it could not read", async () => {
    const host = new FakeHost();
    host.description = { bytes: 3_000_000, source: "upstream", notices: [] };
    host.unreadableCache = true;

    renderSettings(host);

    await waitFor(() =>
      expect(screen.getByText("Not downloaded yet.")).toBeVisible(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(host.removed).toBe(1);
    expect(screen.getByRole("button", { name: "Download now" })).toBeEnabled();
  });
});

describe("removing a cached model", () => {
  it("evicts through the host and returns to the not-downloaded state", async () => {
    const host = new FakeHost();
    host.cached = true;
    host.description = { bytes: 3_000_000, source: "upstream", notices: [] };

    renderSettings(host);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove downloaded model" }),
      ).toBeEnabled(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove downloaded model" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Not downloaded yet.")).toBeVisible(),
    );
    expect(host.removed).toBe(1);
  });
});

function picker(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "On-device model" });
}

function option(name: RegExp): HTMLOptionElement {
  return screen.getByRole("option", { name });
}

describe("choosing among the served entries", () => {
  it("asks for a choice, lists every entry, and runs the default until one is made", async () => {
    renderSettings(new FakeHost());

    await waitFor(() => {
      expect(option(/Qwen3 0\.6B/)).toBeEnabled();
    });
    expect(picker()).toHaveValue("");
    expect(option(/Choose a model/)).toBeDisabled();
    for (const { label } of CATALOG) {
      expect(
        screen.getByRole("option", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    }
    expect(option(/Qwen3 0\.6B/)).toHaveTextContent("Qwen3 0.6B · default");
    // The details under the picker are the default's, since it is what runs.
    expect(screen.getByText(/about 1403 MB of memory/)).toBeVisible();
  });

  it("changing the choice downloads nothing, shows its name, and is kept on this device", async () => {
    const host = new FakeHost();
    renderSettings(host);

    await waitFor(() => {
      expect(option(/SmolLM2 360M/)).toBeEnabled();
    });
    fireEvent.change(picker(), { target: { value: SMOLLM2 } });

    await waitFor(() => {
      expect(picker()).toHaveValue(SMOLLM2);
    });
    expect(screen.queryByRole("option", { name: /Choose a model/ })).toBeNull();
    await waitFor(() => {
      expect(host.described).toContain(SMOLLM2);
    });
    expect(screen.getByText(/about 376 MB of memory/)).toBeVisible();
    expect(host.opened).toBe(0);
    expect(window.localStorage.getItem(LOCAL_MODEL_CHOICE_STORAGE_KEY)).toBe(
      SMOLLM2,
    );
  });

  it("lists an entry this surface refuses, with its reason, and does not let it be chosen", async () => {
    const host = new FakeHost();
    host.verdicts = {
      [LLAMA]: { kind: "over_budget", requiredMb: 879.04, budgetMb: 512 },
    };
    renderSettings(host);

    await waitFor(() => {
      expect(option(/Llama 3\.2 1B/)).toHaveTextContent(
        /— not available here$/,
      );
    });
    expect(option(/Llama 3\.2 1B/)).toBeDisabled();
    expect(
      screen.getByText(
        "Llama 3.2 1B — Not offered here: needs about 879 MB, this surface allows 512 MB.",
      ),
    ).toBeVisible();
  });

  it("falls back to the default when the stored choice is refused here, says so, and keeps it", async () => {
    window.localStorage.setItem(LOCAL_MODEL_CHOICE_STORAGE_KEY, LLAMA);
    const host = new FakeHost();
    host.verdicts = {
      [LLAMA]: { kind: "over_budget", requiredMb: 879.04, budgetMb: 512 },
    };
    renderSettings(host);

    expect(
      await screen.findByText(/The model you chose can’t run here/),
    ).toBeInTheDocument();
    // The picker keeps showing what was chosen; the details are the default's, which runs.
    expect(picker()).toHaveValue(LLAMA);
    expect(screen.getByText(/about 1403 MB of memory/)).toBeVisible();
    expect(window.localStorage.getItem(LOCAL_MODEL_CHOICE_STORAGE_KEY)).toBe(
      LLAMA,
    );
  });

  it("says so when the stored choice is no longer served, and asks again", async () => {
    window.localStorage.setItem(
      LOCAL_MODEL_CHOICE_STORAGE_KEY,
      "gemma3-1b-it-q4f16_1-MLC",
    );
    renderSettings(new FakeHost());

    expect(
      await screen.findByText(/The model you chose is no longer offered/),
    ).toBeInTheDocument();
    expect(picker()).toHaveValue("");
  });

  it("shows Built with Llama wherever its entry is offered", async () => {
    renderSettings(new FakeHost());

    await waitFor(() => {
      expect(option(/Llama 3\.2 1B/)).toHaveTextContent(
        "Llama 3.2 1B · Built with Llama",
      );
    });
  });

  it("links the use policy and repeats the attribution once Llama is chosen", async () => {
    window.localStorage.setItem(LOCAL_MODEL_CHOICE_STORAGE_KEY, LLAMA);
    renderSettings(new FakeHost());

    expect(
      await screen.findByRole("link", { name: "Acceptable use policy" }),
    ).toHaveAttribute("href", "https://www.llama.com/llama3_2/use-policy");
    expect(screen.getByText("Built with Llama")).toBeVisible();
  });

  it("shows the chosen entry's own notices before any download", async () => {
    window.localStorage.setItem(LOCAL_MODEL_CHOICE_STORAGE_KEY, LLAMA);
    renderSettings(new FakeHost());

    expect(
      await screen.findByText(
        /Llama 3\.2 is licensed under the Llama 3\.2 Community License/,
      ),
    ).toBeInTheDocument();
  });
});

describe("choosing a model with an acceptable-use policy", () => {
  it("surfaces the policy note only for the pick that made it apply, not on load", async () => {
    window.localStorage.setItem(LOCAL_MODEL_CHOICE_STORAGE_KEY, LLAMA);
    renderSettings(new FakeHost());

    // The stored choice already carries a use policy, but nobody picked it just now.
    await waitFor(() => expect(picker()).toHaveValue(LLAMA));
    expect(
      screen.queryByText(/Built with Llama\. Usage is subject to Meta's/),
    ).toBeNull();
  });

  it("appears the moment Llama is picked, links the policy, and is not a checkbox", async () => {
    const host = new FakeHost();
    renderSettings(host);

    await waitFor(() => {
      expect(option(/Llama 3\.2 1B/)).toBeInTheDocument();
    });
    fireEvent.change(picker(), { target: { value: LLAMA } });

    const note = await screen.findByText(
      /Built with Llama\. Usage is subject to Meta's/,
    );
    const notePara = note.closest("p")!;
    expect(notePara).toHaveAttribute("role", "status");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      within(notePara).getByRole("link", { name: "Acceptable use policy" }),
    ).toHaveAttribute("href", "https://www.llama.com/llama3_2/use-policy");
    // Nothing is gated behind it: the choice already took effect.
    expect(picker()).toHaveValue(LLAMA);
  });

  it("goes away once a different model is picked", async () => {
    const host = new FakeHost();
    renderSettings(host);

    await waitFor(() => expect(option(/Llama 3\.2 1B/)).toBeInTheDocument());
    fireEvent.change(picker(), { target: { value: LLAMA } });
    await screen.findByText(/Built with Llama\. Usage is subject to Meta's/);

    fireEvent.change(picker(), { target: { value: SMOLLM2 } });

    await waitFor(() => {
      expect(
        screen.queryByText(/Built with Llama\. Usage is subject to Meta's/),
      ).toBeNull();
    });
  });

  it("can be dismissed without changing the choice", async () => {
    const host = new FakeHost();
    renderSettings(host);

    await waitFor(() => expect(option(/Llama 3\.2 1B/)).toBeInTheDocument());
    fireEvent.change(picker(), { target: { value: LLAMA } });
    await screen.findByText(/Built with Llama\. Usage is subject to Meta's/);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(
      screen.queryByText(/Built with Llama\. Usage is subject to Meta's/),
    ).toBeNull();
    expect(picker()).toHaveValue(LLAMA);
  });

  it("does not appear for an entry with no use policy", async () => {
    const host = new FakeHost();
    renderSettings(host);

    await waitFor(() => expect(option(/SmolLM2 360M/)).toBeInTheDocument());
    fireEvent.change(picker(), { target: { value: SMOLLM2 } });

    await waitFor(() => expect(picker()).toHaveValue(SMOLLM2));
    expect(
      screen.queryByText(/Built with Llama\. Usage is subject to Meta's/),
    ).toBeNull();
  });
});
