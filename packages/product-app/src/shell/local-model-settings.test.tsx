// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  LocalModelDescription,
  LocalModelDeviceVerdict,
  LocalModelDownloadProgress,
  LocalModelEngine,
  LocalModelHost,
} from "./local-model-host";
import { LocalModelSettings } from "./local-model-settings";

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

class FakeHost implements LocalModelHost {
  public verdict: LocalModelDeviceVerdict = { kind: "usable" };
  public cached = false;
  public description: LocalModelDescription = {
    bytes: null,
    source: "upstream",
  };
  public opened = 0;
  public unloaded = 0;
  public removed = 0;
  public failOpen = false;

  public inspect(): Promise<LocalModelDeviceVerdict> {
    return Promise.resolve(this.verdict);
  }

  public isCached(): Promise<boolean> {
    return Promise.resolve(this.cached);
  }

  public describe(): Promise<LocalModelDescription> {
    return Promise.resolve(this.description);
  }

  public open(
    _modelId: string,
    onProgress: (progress: LocalModelDownloadProgress) => void,
  ): Promise<LocalModelEngine> {
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
      <LocalModelSettings host={host} modelId={MODEL_ID} />
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
    expect(screen.getByText(/3 MB/)).toBeVisible();
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
