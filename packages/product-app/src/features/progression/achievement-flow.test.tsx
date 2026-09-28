// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  UNSUPPORTED_GEOLOCATION_DOUBLE,
  createMapRendererDouble,
} from "../../../../../tests/support/doubles";
import { createAvaiaSetupViewState } from "../avaia/avaia-setup-view-model";
import { forgetAvatarChoices } from "../identity/avatar-wardrobe-store";
import { AuthenticatedMapHomeView } from "../map/authenticated-map-home-view";
import type {
  LocalModelDependency,
  LocalModelEngine,
  LocalModelHost,
} from "../../shell/local-model-host";
import type { ShellSection } from "../../shell/routes";
import { forgetProgressionCache, progressionSnapshot } from "./progression";

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

class DownloadableHost implements LocalModelHost {
  public cached = false;

  public inspect() {
    return Promise.resolve({ kind: "usable" as const });
  }

  public isCached() {
    return Promise.resolve(this.cached);
  }

  public describe() {
    return Promise.resolve({
      bytes: 350 * 1024 * 1024,
      source: "mirror" as const,
      notices: [],
    });
  }

  public open(): Promise<LocalModelEngine> {
    this.cached = true;
    return Promise.resolve({ unload: () => Promise.resolve() });
  }

  public remove() {
    this.cached = false;
    return Promise.resolve();
  }
}

function localModel(host: LocalModelHost): LocalModelDependency {
  return {
    host,
    defaultModelId: MODEL_ID,
    catalog: [
      {
        modelId: MODEL_ID,
        family: "qwen3",
        label: "Qwen3 0.6B",
        vramMb: 1403,
        licence: "apache-2.0",
        licenceName: "Apache License 2.0",
        attribution: null,
        usePolicy: null,
        notices: [],
        faithfulness: null,
      },
    ],
  };
}

const configuredAvaia = createAvaiaSetupViewState({
  load: {
    kind: "available",
    profile: {
      pubDress: "x0skai",
      ownerPubDress: "0x0sky",
      configurationState: "configured",
    },
  },
  pending: false,
});

function view(section: ShellSection, host: LocalModelHost) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <AuthenticatedMapHomeView
        hostLabel="browser host"
        pubDress="0x0sky"
        avaiaPubDress="x0skai"
        renderer={createMapRendererDouble({ kind: "ready" })}
        geolocation={UNSUPPORTED_GEOLOCATION_DOUBLE}
        runtime={{
          tone: "ready",
          label: "Shared Core ready",
          detail: "Contract 0.1.0 is available to the Web client.",
        }}
        safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
        section={section}
        avaiaSetup={configuredAvaia}
        localModel={localModel(host)}
      />
    </QueryClientProvider>
  );
}

function attentionMarks(): number {
  return document.querySelectorAll(".app-header__attention").length;
}

beforeEach(() => {
  window.localStorage.clear();
  forgetAvatarChoices();
  forgetProgressionCache();
});

afterEach(() => {
  cleanup();
});

describe("the model download step", () => {
  it("marks Settings once the Avaia is configured, until Settings is opened", () => {
    const host = new DownloadableHost();
    const { rerender } = render(view("world", host));
    expect(attentionMarks()).toBeGreaterThan(0);

    rerender(view("settings", host));
    expect(progressionSnapshot("0x0sky").settingsHintSeen).toBe(true);

    rerender(view("world", host));
    expect(attentionMarks()).toBe(0);
  });

  it("pays once per device for the model, to the Bond and the Avaia", async () => {
    const host = new DownloadableHost();
    render(view("settings", host));

    const download = await screen.findByRole("button", {
      name: "Download now",
    });
    await screen.findByText(
      "Pays once on this device: +50 Bond and +100 Avaia experience.",
    );
    expect(download.querySelector(".attention-dot")).not.toBeNull();

    fireEvent.click(download);

    const dialog = await screen.findByRole("dialog", {
      name: "Avaia model downloaded",
    });
    expect(dialog).toHaveTextContent("+50 Bond experience");
    expect(dialog).toHaveTextContent("+100 Avaia experience");
    // 20 for configuring and 50 here: the Bond crosses level 1 too.
    expect(dialog).toHaveTextContent("0x0sky reached level 1");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(progressionSnapshot("0x0sky").deviceAchievements).toEqual([
      "avaia-model-downloaded",
    ]);
    expect(screen.queryByText(/Pays once on this device/)).toBeNull();
    expect(document.querySelector(".attention-dot")).toBeNull();
  });

  it("pays for a model this device already holds, and never twice", async () => {
    const host = new DownloadableHost();
    host.cached = true;
    const first = render(view("settings", host));
    await screen.findByRole("dialog", { name: "Avaia model downloaded" });
    first.unmount();

    render(view("settings", host));
    await screen.findByText("Downloaded and cached on this device.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
