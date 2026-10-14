// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaProfileAccessPort,
  AvaiaProfileProjection,
  CoreRuntimePort,
  IdentityAccessPort,
} from "@nilx-one/application";
import {
  SILENT_SOUND,
  UNSUPPORTED_GEOLOCATION,
  type HostPort,
  type SoundCapability,
} from "@nilx-one/host-contract";
import { ProductApp } from "@nilx-one/product-app";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetGuideSession } from "../../packages/product-app/src/features/guide/guide-memory";
import { createMapRendererDouble } from "../support/doubles";

const readyCore: CoreRuntimePort = {
  probe: async () => ({ kind: "ready", contractVersion: "0.1.0" }),
};

/** Long enough for the world to settle and for her to decide to walk up. */
const ARRIVAL_WAIT = { timeout: 4_000 };

type User = ReturnType<typeof userEvent.setup>;

function createHost(sound: SoundCapability = SILENT_SOUND): HostPort {
  return {
    getSnapshot: () => ({
      kind: "browser",
      available: true,
      theme: "dark",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      authentication: { kind: "browser-session" },
    }),
    subscribe: () => () => undefined,
    ready: vi.fn(),
    openExternal: vi.fn(),
    impact: vi.fn(),
    geolocation: UNSUPPORTED_GEOLOCATION,
    sound,
  };
}

function projection(
  overrides: Partial<AvaiaProfileProjection> = {},
): AvaiaProfileProjection {
  return {
    pubDress: "x0skai",
    ownerPubDress: "0x0sky",
    configurationState: "unconfigured",
    ...overrides,
  };
}

type Identity = IdentityAccessPort & AvaiaProfileAccessPort;

/** Every call that could change what the service holds for this Bond. */
const MUTATIONS = [
  "chooseAvatarModel",
  "renameAvaiaSlug",
  "renamePubDressSlug",
  "setProviderPassword",
  "registerProvider",
  "linkTelegramProvider",
  "updateAvaiaProfile",
  "publishAvaiaLocation",
] as const satisfies readonly (keyof Identity)[];

function createIdentity(
  initial: AvaiaProfileProjection = projection(),
): Identity {
  let stored = initial;
  const identity: Identity = {
    acknowledgeRecoveryKey: async () => ({ kind: "service-unavailable" }),
    authenticateNative: async () => ({ kind: "service-unavailable" }),
    forgetRememberedBond: async () => ({ kind: "completed" }),
    logoutNative: async () => ({ kind: "completed" }),
    readNativeContext: async () => ({
      kind: "authenticated",
      identity: {
        pubDress: "0x0sky",
        avaiaPubDress: "x0skai",
        avatarModel: "sky-study",
      },
    }),
    readProviderIdentity: async () => ({ kind: "not-registered" }),
    recoverNative: async () => ({ kind: "service-unavailable" }),
    registerNative: async () => ({ kind: "service-unavailable" }),
    chooseAvatarModel: async () => ({ kind: "service-unavailable" }),
    renameAvaiaSlug: async () => ({ kind: "service-unavailable" }),
    renamePubDressSlug: async () => ({ kind: "service-unavailable" }),
    setProviderPassword: async () => ({ kind: "service-unavailable" }),
    registerProvider: async () => ({ kind: "service-unavailable" }),
    resolvePubDressLabel: async (label) => ({ kind: "available", label }),
    linkTelegramProvider: async () => ({ kind: "linked" }),
    resolvePubDress: async () => ({ kind: "service-unavailable" }),
    readAvaiaProfile: async () => ({ kind: "available", profile: stored }),
    updateAvaiaProfile: async (pubDress) => {
      stored = projection({ pubDress, configurationState: "configured" });
      return { kind: "updated", profile: stored };
    },
    publishAvaiaLocation: async () => ({ kind: "service-unavailable" }),
  };
  for (const name of MUTATIONS) {
    Object.assign(identity, { [name]: vi.fn(identity[name]) });
  }
  return identity;
}

/** A host whose identity client has not reached the Avaia profile contract. */
function withoutAvaiaProfile(identity: Identity): IdentityAccessPort {
  const {
    readAvaiaProfile: _read,
    updateAvaiaProfile: _update,
    publishAvaiaLocation: _publish,
    ...rest
  } = identity;
  return rest;
}

function mutationsCalled(identity: Identity): string[] {
  return MUTATIONS.filter(
    (name) => vi.mocked(identity[name]).mock.calls.length > 0,
  );
}

function scene(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>(
    ".guide-cutscene [role='dialog']",
  );
  if (dialog === null) throw new Error("No scene is playing.");
  return dialog;
}

/** Hurry her along — the walk, the typing, a reply — until she asks. */
async function untilReplies(user: User): Promise<HTMLElement[]> {
  await waitFor(async () => {
    const choices = scene().querySelectorAll(".guide-cutscene__choice");
    if (choices.length > 0) return;
    const hurry = within(scene()).queryByRole("button", { name: "Continue" });
    if (hurry !== null) await user.click(hurry);
    throw new Error("Still talking.");
  });
  return [...scene().querySelectorAll<HTMLElement>(".guide-cutscene__choice")];
}

/** Let her go, without waiting for her to walk all the way off. */
async function untilGone(user: User): Promise<void> {
  await waitFor(async () => {
    const dialog = document.querySelector(".guide-cutscene");
    if (dialog === null) return;
    const hurry = within(scene()).queryByRole("button", { name: "Continue" });
    if (hurry !== null) await user.click(hurry);
    throw new Error("Still here.");
  });
}

function renderWorld(
  renderer = createMapRendererDouble({ kind: "ready" }),
  identity: IdentityAccessPort = createIdentity(),
  sound?: SoundCapability,
) {
  const { container } = render(
    <ProductApp
      core={readyCore}
      host={createHost(sound)}
      mapRenderer={renderer}
      identity={identity}
    />,
  );
  return Object.assign(renderer, { container });
}

describe("xSasha, the first time a Bond opens the world", () => {
  beforeEach(() => {
    window.localStorage.clear();
    forgetGuideSession();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("says her lines aloud, and never the Bond's own replies", async () => {
    const user = userEvent.setup();
    const sound = {
      supported: true,
      setEnabled: vi.fn(),
      play: vi.fn(),
      setAmbience: vi.fn(),
      speak: vi.fn<SoundCapability["speak"]>(),
    };
    renderWorld(undefined, undefined, sound);

    await screen.findByRole("dialog", { name: "xSasha" }, ARRIVAL_WAIT);
    const replies = await untilReplies(user);
    // The Bond wears Sky, so she is Dasha 2.0 and speaks in the feminine.
    await waitFor(() =>
      expect(sound.speak).toHaveBeenCalledWith({
        url: expect.stringMatching(
          /^\/voices\/0\.1\.0\/en\/xsasha-feminine\/guide\.intro\.greeting\.\d\.feminine\.mp3$/,
        ),
      }),
    );

    await user.click(replies[0] as HTMLElement);
    await untilReplies(user);
    await waitFor(() =>
      expect(sound.speak).toHaveBeenCalledWith({
        url: expect.stringMatching(
          /\/xsasha-feminine\/guide\.intro\.howTo\.\d\.mp3$/,
        ),
      }),
    );
    // Every line heard is one of hers: a reply the Bond chose is only read.
    for (const [line] of sound.speak.mock.calls) {
      expect(line.url).toMatch(/\/xsasha-feminine\/guide\.(intro|reward)\./);
    }
    expect(sound.speak).toHaveBeenCalledTimes(2);
  });

  it("keeps her quiet when character voices are off", async () => {
    window.localStorage.setItem("nilx-one.interface.voice", "off");
    const user = userEvent.setup();
    const sound = {
      supported: true,
      setEnabled: vi.fn(),
      play: vi.fn(),
      setAmbience: vi.fn(),
      speak: vi.fn<SoundCapability["speak"]>(),
    };
    renderWorld(undefined, undefined, sound);

    await screen.findByRole("dialog", { name: "xSasha" }, ARRIVAL_WAIT);
    await untilReplies(user);
    expect(sound.speak).not.toHaveBeenCalled();
  });

  it("walks up, asks for an Avaia, and opens its setup when asked how", async () => {
    const user = userEvent.setup();
    const renderer = renderWorld();

    const dialog = await screen.findByRole(
      "dialog",
      { name: "xSasha" },
      ARRIVAL_WAIT,
    );
    // She is on the world itself, beside the Bond, never its twin: the
    // Bond wears Sky, so she is drawn as Dasha 2.0. Her body is drawn on the
    // next animation frame, which can land after the dialog on a busy runner.
    await waitFor(() =>
      expect(renderer.avatars?.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: "guide", modelId: "dasha-v2-study" }),
      ),
    );
    // The camera is the scene's: it is staged close in, not left where it was.
    await waitFor(() =>
      expect(renderer.getCamera().zoom).toBeGreaterThanOrEqual(19),
    );
    expect(document.querySelector(".app-shell")).toHaveAttribute(
      "data-cutscene",
      "true",
    );

    const replies = await untilReplies(user);
    expect(dialog).toHaveTextContent(/bunny/);
    expect(dialog).toHaveTextContent(/Avaia/);
    expect(replies).toHaveLength(2);
    expect(replies[1]).toHaveTextContent(/Later|Not now|Some other time/);

    // "It's strange. I feel I've been here before." — said in the Bond's own
    // voice, then she tells it how.
    await user.click(replies[0] as HTMLElement);
    expect(dialog).toHaveTextContent("0x0sky");
    const how = await untilReplies(user);
    expect(dialog).toHaveTextContent("x0skai");
    expect(dialog).toHaveTextContent("Create");

    await user.click(how[0] as HTMLElement);
    await untilGone(user);

    expect(await screen.findByLabelText("pub_dress")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(renderer.avatars?.remove).toHaveBeenCalledWith("guide");
    expect(document.querySelector(".app-shell")).toHaveAttribute(
      "data-cutscene",
      "false",
    );
    expect(
      JSON.parse(window.localStorage.getItem("nilx-one.guide.v1.0x0sky") ?? ""),
    ).toEqual({ intro: "done" });
  }, 15_000);

  it("comes back to say what the Avaia paid, and leaves the two of them together", async () => {
    const user = userEvent.setup();
    const renderer = renderWorld();

    await user.click(
      await screen.findByRole("button", { name: "Set up x0skai" }),
    );
    const address = await screen.findByLabelText("pub_dress");
    await waitFor(() => expect(address).toHaveValue("sk"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    const thanks = await untilReplies(user);
    const dialog = screen.getByRole("dialog", { name: "Avaia configured" });
    // She nearly forgot: she calls the Bond by its pub_dress as she pays it.
    expect(dialog).toHaveTextContent("0x0sky");
    expect(dialog).toHaveTextContent(/forgot|nearly left|yours/);
    expect(dialog).toHaveTextContent("+20 Bond experience");
    expect(dialog).toHaveTextContent("x0skai reached level 1");
    // The Bond's gain is cyan, its Avaia's violet.
    expect(
      dialog.querySelector('.guide-xp[data-subject="bond"][data-kind="xp"]'),
    ).toHaveTextContent("+20 Bond experience");
    expect(
      dialog.querySelector(
        '.guide-xp[data-subject="avaia"][data-kind="level"]',
      ),
    ).toHaveTextContent("x0skai reached level 1");

    await user.click(thanks[0] as HTMLElement);
    const onward = await untilReplies(user);
    expect(onward).toHaveLength(1);
    expect(onward[0]).toHaveTextContent("(continue)");
    // The line said to the two of them has the Avaia there too: three on
    // the world, the Bond and its Avaia in frame.
    expect(renderer.avatars?.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "guide-avaia" }),
    );
    await user.click(onward[0] as HTMLElement);
    await untilGone(user);

    // What was paid has left the scene for the corner the Dock stands in,
    // top first, the Bond's before its Avaia's.
    const toasts = document.querySelector(".guide-reward-toasts");
    expect(toasts).not.toBeNull();
    expect(
      [...(toasts?.querySelectorAll(".guide-toast") ?? [])].map((toast) => [
        toast.getAttribute("data-subject"),
        toast.textContent,
      ]),
    ).toEqual([
      ["bond", "+20 Bond experience"],
      ["avaia", "x0skai reached level 1"],
    ]);

    // It is the Bond and its Avaia now: the Avaia takes the wheel.
    expect(
      await screen.findByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toBeVisible();
  }, 15_000);

  it("has no automatically detectable accessibility violations", async () => {
    const user = userEvent.setup();
    const { container } = renderWorld();

    await screen.findByRole("dialog", { name: "xSasha" }, ARRIVAL_WAIT);
    await untilReplies(user);
    const results = await act(() => axe.run(container));
    expect(results.violations).toEqual([]);
  }, 15_000);

  it("changes nothing the service holds by being answered", async () => {
    const user = userEvent.setup();
    const identity = createIdentity();
    renderWorld(createMapRendererDouble({ kind: "ready" }), identity);

    await screen.findByRole("dialog", { name: "xSasha" }, ARRIVAL_WAIT);
    await user.click((await untilReplies(user))[0] as HTMLElement);
    await user.click((await untilReplies(user))[0] as HTMLElement);
    await untilGone(user);

    // A reply is not an Interaction, a consent or a configuration: nothing
    // was asked of the service, and the Avaia is exactly as unconfigured as
    // the service said — the scene only opened the screen where it is set up.
    expect(mutationsCalled(identity)).toEqual([]);
    expect(await screen.findByLabelText("pub_dress")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create" })).toBeVisible();
  }, 15_000);

  it("never invents an Avaia on a host that cannot read one", async () => {
    renderWorld(
      createMapRendererDouble({ kind: "ready" }),
      withoutAvaiaProfile(createIdentity()),
    );

    await screen.findByRole("button", { name: "Take the wheel as 0x0sky" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 2_400)));
    expect(document.querySelector(".guide-cutscene")).toBeNull();
  }, 10_000);

  it("leaves a world that the service alone can rebuild", async () => {
    const user = userEvent.setup();
    const identity = createIdentity();
    renderWorld(createMapRendererDouble({ kind: "ready" }), identity);

    await user.click(
      await screen.findByRole("button", { name: "Set up x0skai" }),
    );
    const address = await screen.findByLabelText("pub_dress");
    await waitFor(() => expect(address).toHaveValue("sk"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click((await untilReplies(user))[0] as HTMLElement);
    await user.click((await untilReplies(user))[0] as HTMLElement);
    await untilGone(user);

    // The only thing the service was asked is what the person did: Create.
    expect(mutationsCalled(identity)).toEqual(["updateAvaiaProfile"]);
    expect(identity.updateAvaiaProfile).toHaveBeenCalledOnce();

    // Forget everything this device kept — scenes, progress, bodies — and
    // open the world again against the same service.
    cleanup();
    window.localStorage.clear();
    renderWorld(
      createMapRendererDouble({ kind: "ready" }),
      createIdentity(
        projection({ pubDress: "x0skai", configurationState: "configured" }),
      ),
    );

    // The Avaia is the service's answer, not a memory of the scene: it is
    // configured, opens at the wheel, and nobody introduces it again.
    expect(
      await screen.findByRole("button", { name: "Focus the world on x0skai" }),
    ).not.toHaveTextContent("unconfigured");
    await act(() => new Promise((resolve) => setTimeout(resolve, 2_400)));
    expect(document.querySelector(".guide-cutscene")).toBeNull();
  }, 20_000);

  it("cuts a skipped reward short, pays it all the same, and turns back to hand over the wheel", async () => {
    const user = userEvent.setup();
    const renderer = renderWorld();

    await user.click(
      await screen.findByRole("button", { name: "Set up x0skai" }),
    );
    const address = await screen.findByLabelText("pub_dress");
    await waitFor(() => expect(address).toHaveValue("sk"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    const replies = await untilReplies(user);
    expect(replies[1]).toHaveTextContent("(skip)");
    const cameraMoves = vi.mocked(renderer.setCamera).mock.calls.length;
    await user.click(replies[1] as HTMLElement);

    // A cut, not a walk off: she does not take the 2.4 s she needs to leave.
    await waitFor(() =>
      expect(document.querySelector(".guide-cutscene")).toBeNull(),
    );
    expect(renderer.avatars?.remove).toHaveBeenCalledWith("guide");
    expect(
      vi
        .mocked(renderer.setCamera)
        .mock.calls.slice(cameraMoves)
        .some(([, options]) => options?.motion === "immediate"),
    ).toBe(true);

    // What the reward paid is paid, and goes to the corner as it always does.
    await waitFor(() => {
      const toasts = document.querySelector(".guide-reward-toasts");
      expect(
        [...(toasts?.querySelectorAll(".guide-toast") ?? [])].map(
          (toast) => toast.textContent,
        ),
      ).toEqual(["+20 Bond experience", "x0skai reached level 1"]);
    }, ARRIVAL_WAIT);
    // Skipping did not hand the wheel over.
    expect(
      screen.queryByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toBeNull();

    // A few seconds on she turns back for the one thing it left unsaid.
    const dialog = await screen.findByRole(
      "dialog",
      { name: "xSasha" },
      { timeout: 9_000 },
    );
    const onward = await untilReplies(user);
    expect(dialog).toHaveTextContent(/forgot|one more thing/i);
    expect(onward).toHaveLength(1);
    expect(onward[0]).toHaveTextContent("(continue)");
    await user.click(onward[0] as HTMLElement);
    await untilGone(user);

    expect(
      await screen.findByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toBeVisible();
    // Each scene leaves its receipt, and the afterthought exactly one.
    expect(
      screen.getAllByText("x0skai takes the wheel. It’s the two of you now."),
    ).toHaveLength(1);
  }, 30_000);

  it("sends the reward to the corner however fast it is skipped, for a person who asked for less motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          onchange: null,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    try {
      const user = userEvent.setup();
      renderWorld();

      await user.click(
        await screen.findByRole("button", { name: "Set up x0skai" }),
      );
      const address = await screen.findByLabelText("pub_dress");
      await waitFor(() => expect(address).toHaveValue("sk"));
      await user.click(screen.getByRole("button", { name: "Create" }));

      // She is already there and the line is whole: skipped the moment it
      // can be.
      const skip = await screen.findByRole("button", { name: /\(skip\)/ });
      await user.click(skip);
      await waitFor(() =>
        expect(document.querySelector(".guide-cutscene")).toBeNull(),
      );

      await waitFor(() => {
        const toasts = document.querySelector(".guide-reward-toasts");
        expect(
          [...(toasts?.querySelectorAll(".guide-toast") ?? [])].map(
            (toast) => toast.textContent,
          ),
        ).toEqual(["+20 Bond experience", "x0skai reached level 1"]);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);

  it("cuts the afterthought short without her turning back a third time", async () => {
    const user = userEvent.setup();
    renderWorld();

    await user.click(
      await screen.findByRole("button", { name: "Set up x0skai" }),
    );
    const address = await screen.findByLabelText("pub_dress");
    await waitFor(() => expect(address).toHaveValue("sk"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click((await untilReplies(user))[1] as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector(".guide-cutscene")).toBeNull(),
    );

    await screen.findByRole("dialog", { name: "xSasha" }, { timeout: 9_000 });
    await untilReplies(user);
    // The only way out of it is to go on: there is nothing in it to skip.
    expect(document.querySelector("[data-reply='skip']")).toBeNull();
    await user.keyboard("{Escape}");
    await untilGone(user);
    await act(() => new Promise((resolve) => setTimeout(resolve, 4_200)));
    expect(document.querySelector(".guide-cutscene")).toBeNull();
  }, 30_000);

  it("keeps away from a login that comes within half an hour of putting her off", async () => {
    window.localStorage.setItem(
      "nilx-one.guide.v1.0x0sky",
      JSON.stringify({
        introSnooze: { skips: 1, at: Date.now() - 15 * 60_000 },
      }),
    );
    renderWorld();

    await screen.findByRole("button", { name: "Set up x0skai" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 2_400)));
    expect(document.querySelector(".guide-cutscene")).toBeNull();
  }, 10_000);

  it("walks up for the first login after half an hour", async () => {
    window.localStorage.setItem(
      "nilx-one.guide.v1.0x0sky",
      JSON.stringify({
        introSnooze: { skips: 1, at: Date.now() - 31 * 60_000 },
      }),
    );
    renderWorld();

    await screen.findByRole("dialog", { name: "xSasha" }, ARRIVAL_WAIT);
  }, 15_000);

  it("waits twice as long the second time she was put off", async () => {
    window.localStorage.setItem(
      "nilx-one.guide.v1.0x0sky",
      JSON.stringify({
        introSnooze: { skips: 2, at: Date.now() - 45 * 60_000 },
      }),
    );
    renderWorld();

    await screen.findByRole("button", { name: "Set up x0skai" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 2_400)));
    expect(document.querySelector(".guide-cutscene")).toBeNull();
  }, 10_000);

  it("is sorry to go when put off, and remembers when and how often", async () => {
    const user = userEvent.setup();
    renderWorld();

    await screen.findByRole("dialog", { name: "xSasha" }, ARRIVAL_WAIT);
    const replies = await untilReplies(user);
    const before = Date.now();
    await user.click(replies[1] as HTMLElement);
    const farewell = await untilReplies(user);
    await user.click(farewell[0] as HTMLElement);
    await untilGone(user);

    // She is back on her own schedule, so this is kept, with when it was said.
    const kept = JSON.parse(
      window.localStorage.getItem("nilx-one.guide.v1.0x0sky") ?? "",
    ) as { introSnooze: { skips: number; at: number } };
    expect(kept.introSnooze.skips).toBe(1);
    expect(kept.introSnooze.at).toBeGreaterThanOrEqual(before);
    expect(
      screen.getByRole("button", { name: "Set up x0skai" }),
    ).toBeInTheDocument();
    // And she does not walk up again straight away.
    await act(() => new Promise((resolve) => setTimeout(resolve, 2_400)));
    expect(document.querySelector(".guide-cutscene")).toBeNull();
  }, 20_000);
});
