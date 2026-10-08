// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaDriveAnswer,
  AvaiaDriveCommand,
  AvaiaDriveInput,
  AvatarModel,
  AvatarModelResult,
  BondProviderConnections,
  CommittedAwardAccessPort,
  CoreRuntimePort,
  NearbySpeechAccessPort,
} from "@nilx-one/application";
import {
  createDeclaredGeolocation,
  type GeolocationCapability,
  type SoundCapability,
} from "@nilx-one/host-contract";
import {
  avatarPreviewUrl,
  MAP_BODY_HANDOVER_ZOOM,
  MAP_SCALE_ZOOM,
  type MapRenderer,
  type MapRendererStatus,
} from "@nilx-one/map-contract";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UNSUPPORTED_GEOLOCATION_DOUBLE,
  createFogFieldDouble,
  createGeolocationDouble,
  createMapRendererDouble,
  observation,
} from "../../../../../tests/support/doubles";
import {
  createAvaiaSetupViewState,
  type AvaiaSetupViewState,
} from "../avaia/avaia-setup-view-model";
import { createAvatarChoiceViewState } from "../identity/avatar-choice-view-model";
import { forgetAvatarChoices } from "../identity/avatar-wardrobe-store";
import { createProfileSlugViewState } from "../identity/profile-slug-view-model";
import type { AddressSlugViewState } from "../identity/profile-slug-view-model";
import { chooseLocale } from "../../shell/localization";
import type {
  LocalModelDependency,
  LocalModelHost,
} from "../../shell/local-model-host";
import type { ShellRoute, ShellSection } from "../../shell/routes";
import type { AvaiaAvailability } from "./bond-dock-view-model";
import { avaiaStudy } from "./avatar-presence";
import { avaiaLines } from "./avaia-lines";
import { avaiaVoiceUrl } from "./avaia-voice";
import { forgetNotebookCache } from "./landmark-notebook";
import { SPEECH_MS } from "./use-avaia-walk";
import { READINESS_FRAME_SETTLE_MS } from "./use-readiness-frame";
import { readWorldMemory, rememberWorld } from "./world-memory";
import {
  AuthenticatedMapHomeView,
  levelFill,
  type ConnectedProvider,
} from "./authenticated-map-home-view";

function renderer(status: MapRendererStatus = { kind: "ready" }): MapRenderer {
  return createMapRendererDouble(status);
}

/**
 * A stand-in for Core's drive that is only curious: on every idle moment it
 * asks for something to go and see, goes, studies it, and asks again in a
 * while when there was nothing. The drive itself is Core's and tested there.
 */
function curiousCore(): Pick<CoreRuntimePort, "avaiaDriveStep"> {
  const script = (input: AvaiaDriveInput): AvaiaDriveCommand[] => {
    switch (input.type) {
      case "stopped":
      case "tick":
        return [{ do: "resolve", what: "curiosity", min_m: 0, max_m: 3_000 }];
      case "curiosity_options": {
        const first = input.to[0];
        return first === undefined
          ? [{ do: "wake_at", ms: Date.now() + 5_000 }]
          : [
              { do: "walk", to: first.ref, purpose: "curiosity", grass: false },
              { do: "say", line: "landmark.spotted", about: first.ref },
            ];
      }
      default:
        return [];
    }
  };
  let studying: string | undefined;
  return {
    avaiaDriveStep: async (
      _state: string,
      input: AvaiaDriveInput,
    ): Promise<AvaiaDriveAnswer> => {
      if (input.type === "curiosity_options") studying = input.to[0]?.ref;
      const commands: AvaiaDriveCommand[] =
        input.type === "arrived" && studying !== undefined
          ? [{ do: "study", at: studying }]
          : script(input);
      return { ok: true, state: "{}", commands };
    },
  };
}

/**
 * Contract-compatible stub for map tests that exercise fog work: Core's
 * documented policy, including the carried blocked bit (docs/avaia-proximity.md
 * in core). Fog work also needs an Avaia with a place of her own, which these
 * tests give her with `avaiaStandsAt`.
 */
function nearbyProximityCore(): Pick<CoreRuntimePort, "avaiaProximity"> {
  return {
    avaiaProximity: async (distanceMeters, artifacts, previouslyBlocked) => {
      const blocked =
        distanceMeters >= 5_000 ||
        (previouslyBlocked && distanceMeters >= 4_500);
      return {
        distance_m: distanceMeters,
        red_m: 5_000,
        restore_below_m: 4_500,
        level:
          distanceMeters >= 5_000
            ? "red"
            : distanceMeters >= 4_500
              ? "restricted"
              : distanceMeters < 15
                ? "near"
                : "working",
        can_reveal: !blocked,
        duration_ms: blocked ? null : 60_000 + artifacts * 1_000,
      };
    },
  };
}

/** Where Avaia was left, so the Bond's distance to her is a measured one. */
function avaiaStandsAt(point: { longitude: number; latitude: number }): void {
  rememberWorld("0x0sky", { avaia: { ...point, bearingDeg: 0 } });
}

interface ViewOverrides {
  findItems?: Partial<CoreRuntimePort>;
  committedAwards?: CommittedAwardAccessPort;
  nearbySpeech?: NearbySpeechAccessPort;
  sound?: SoundCapability;
  avaiaPubDress?: string;
  connectedProviders?: BondProviderConnections;
  providerDeepLinks?: readonly ConnectedProvider[];
  onDisconnectProvider?: (provider: ConnectedProvider) => void;
  geolocation?: GeolocationCapability;
  mapRenderer?: MapRenderer;
  localModel?: LocalModelDependency;
  section?: ShellSection;
  avaiaAvailability?: AvaiaAvailability;
  onPrepareAvaia?: () => void;
  slugEdit?: AddressSlugViewState;
  avatarChoice?: ReturnType<typeof createAvatarChoiceViewState>;
  onAvatarChoice?: (
    model: "sky-study" | "dasha-study" | "kai-study" | "dasha-v2-study",
  ) => Promise<AvatarModelResult | undefined>;
  avaiaSetup?: AvaiaSetupViewState;
  onLogout?: () => void;
  onNavigate?: (route: ShellRoute) => void;
  onSlugChange?: (slug: string) => void;
  onSlugSubmit?: () => void;
}

function renderView(overrides: ViewOverrides = {}) {
  const optionalProps = {
    connectedProviders: overrides.connectedProviders ?? [],
    ...(overrides.findItems === undefined
      ? {}
      : { findItems: overrides.findItems }),
    ...(overrides.committedAwards === undefined
      ? {}
      : { committedAwards: overrides.committedAwards }),
    ...(overrides.nearbySpeech === undefined
      ? {}
      : { nearbySpeech: overrides.nearbySpeech }),
    ...(overrides.sound === undefined ? {} : { sound: overrides.sound }),
    ...(overrides.localModel === undefined
      ? {}
      : { localModel: overrides.localModel }),
    ...(overrides.providerDeepLinks === undefined
      ? {}
      : { providerDeepLinks: overrides.providerDeepLinks }),
    ...(overrides.onDisconnectProvider === undefined
      ? {}
      : { onDisconnectProvider: overrides.onDisconnectProvider }),
    ...(overrides.onLogout === undefined
      ? {}
      : { onLogout: overrides.onLogout }),
    ...(overrides.onNavigate === undefined
      ? {}
      : { onNavigate: overrides.onNavigate }),
    ...(overrides.avaiaAvailability === undefined
      ? {}
      : { avaiaAvailability: overrides.avaiaAvailability }),
    ...(overrides.onPrepareAvaia === undefined
      ? {}
      : { onPrepareAvaia: overrides.onPrepareAvaia }),
    ...(overrides.slugEdit === undefined
      ? {}
      : { slugEdit: overrides.slugEdit }),
    ...(overrides.avatarChoice === undefined
      ? {}
      : { avatarChoice: overrides.avatarChoice }),
    ...(overrides.onAvatarChoice === undefined
      ? {}
      : { onAvatarChoice: overrides.onAvatarChoice }),
    ...(overrides.avaiaSetup === undefined
      ? {}
      : { avaiaSetup: overrides.avaiaSetup }),
    ...(overrides.onSlugChange === undefined
      ? {}
      : { onSlugChange: overrides.onSlugChange }),
    ...(overrides.onSlugSubmit === undefined
      ? {}
      : { onSlugSubmit: overrides.onSlugSubmit }),
  };

  return render(
    <AuthenticatedMapHomeView
      hostLabel="browser host"
      pubDress="0x0sky"
      avaiaPubDress={overrides.avaiaPubDress ?? "x0skai"}
      renderer={overrides.mapRenderer ?? renderer()}
      geolocation={overrides.geolocation ?? UNSUPPORTED_GEOLOCATION_DOUBLE}
      runtime={{
        tone: "ready",
        label: "Shared Core ready",
        detail: "Contract 0.1.0 is available to the Web client.",
      }}
      safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      section={overrides.section ?? "world"}
      {...optionalProps}
    />,
  );
}

function soundDouble() {
  return {
    supported: true,
    play: vi.fn<SoundCapability["play"]>(),
    setEnabled: vi.fn<SoundCapability["setEnabled"]>(),
    setAmbience: vi.fn<SoundCapability["setAmbience"]>(),
    speak: vi.fn<SoundCapability["speak"]>(),
  } satisfies SoundCapability;
}

function dock(container: HTMLElement): HTMLElement {
  const surface = container.querySelector<HTMLElement>(".bond-dock");
  expect(surface).not.toBeNull();
  return surface as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
  // The wardrobe keeps a module-level snapshot so React can compare it, so
  // clearing storage alone would leave the previous test's outfit in memory.
  forgetAvatarChoices();
  forgetNotebookCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  chooseLocale("auto");
});

describe("AuthenticatedMapHomeView spoken lines", () => {
  function speaking(text: string, speaker = "0xfrSb"): NearbySpeechAccessPort {
    return {
      readNearbySpeech: async () => [
        {
          id: `line_${"a".repeat(64)}`,
          speaker,
          text,
          spokenAt: Math.floor(Date.now() / 1000),
        },
      ],
    };
  }

  it("says a heard line in the notice stack, under the speaker's name", async () => {
    renderView({ nearbySpeech: speaking("привіт усім") });

    const words = await screen.findByText("привіт усім");
    const notice = words.closest("li, [role='status'], article, div");
    expect(notice).not.toBeNull();
    expect(within(notice as HTMLElement).getByText("0xfrSb")).toBeTruthy();
  });

  it("lets a person close a heard line, and it does not come back on the next poll", async () => {
    renderView({ nearbySpeech: speaking("тихо") });

    await screen.findByText("тихо");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: 0xfrSb" }));
    expect(screen.queryByText("тихо")).toBeNull();
  });

  it("has nothing to say when the host offers no speech", async () => {
    renderView();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("привіт усім")).toBeNull();
  });
});

describe("AuthenticatedMapHomeView", () => {
  it("presents the compact Bond pair without inventing reciprocity", () => {
    const mapRenderer = renderer();

    renderView({ mapRenderer });

    // Authentication opens on the Avaia, with the Bond represented by this
    // device spectating until it takes the wheel back.
    expect(
      screen.getByRole("button", { name: "Focus the world on x0skai" }),
    ).toHaveTextContent("AI");
    expect(
      screen.getByRole("button", { name: "Focus the world on x0skai" }),
    ).toHaveTextContent("driving");
    expect(
      screen.getByRole("separator", {
        name: "No reciprocal relationship asserted",
      }),
    ).toBeEmptyDOMElement();
    expect(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toHaveTextContent("spectate");
    expect(screen.getByText("x0skai")).toBeVisible();
    expect(screen.getByText("Shared Core ready")).toBeVisible();
    expect(screen.getByText("contract 0.1.0")).toBeVisible();
    expect(mapRenderer.mount).toHaveBeenCalledOnce();
  });

  it("drops the authenticated success hero from the world surface", () => {
    renderView();

    expect(screen.queryByText("You’re in.")).toBeNull();
    expect(screen.queryByText(/Authenticated as/)).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("keeps application settings out of the Bond surface", () => {
    const { container } = renderView();
    const surface = dock(container);

    expect(
      within(surface).queryByRole("button", { name: /settings/i }),
    ).toBeNull();
    expect(
      within(surface).queryByRole("link", { name: /settings/i }),
    ).toBeNull();
    expect(surface.querySelector("[href='/settings']")).toBeNull();
  });

  it("keeps the world behind the Dock, the header and the toast stack", () => {
    const { container } = renderView();
    const shell = container.querySelector(".app-shell");
    const bottom = container.querySelector(".app-shell__bottom");

    expect(shell?.querySelector(".app-shell__world")).not.toBeNull();
    expect(bottom?.querySelector(".bond-dock")).not.toBeNull();
    expect(bottom?.querySelector(".app-shell__toasts")).toBeNull();
    expect(
      container.querySelector(".app-shell__toasts .toast-region"),
    ).not.toBeNull();
    expect(
      container.querySelector(".app-shell__status .core-chip"),
    ).not.toBeNull();
  });

  it("hands the wheel to the Avaia and back to the Bond", () => {
    renderView({ avaiaAvailability: "ready" });
    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );
    expect(
      screen.getByRole("button", { name: "Focus the world on 0x0sky" }),
    ).toHaveTextContent("driving");

    const handToAvaia = screen.getByRole("button", {
      name: "Hand the wheel to x0skai",
    });
    expect(handToAvaia).toBeEnabled();
    expect(handToAvaia).toHaveTextContent("ready");

    fireEvent.click(handToAvaia);

    expect(
      screen.getByRole("button", { name: "Focus the world on x0skai" }),
    ).toHaveTextContent("driving");
    expect(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toHaveTextContent("spectate");

    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );

    expect(
      screen.getByRole("button", { name: "Focus the world on 0x0sky" }),
    ).toHaveTextContent("driving");
  });

  it("asks this host for a runtime as the Avaia takes the wheel", () => {
    const onPrepareAvaia = vi.fn();
    renderView({ avaiaAvailability: "downloadable", onPrepareAvaia });

    // Opening on the Avaia is presentation: nothing is fetched until a person
    // hands it the wheel with a gesture of their own.
    expect(onPrepareAvaia).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );
    expect(onPrepareAvaia).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Hand the wheel to x0skai" }),
    );

    expect(onPrepareAvaia).toHaveBeenCalledOnce();

    // A host that cannot fetch one still hands the wheel over.
    cleanup();
    renderView({ avaiaAvailability: "downloadable" });
    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );
    const avaia = screen.getByRole("button", {
      name: "Hand the wheel to x0skai",
    });
    expect(avaia).toBeEnabled();
    fireEvent.click(avaia);
    expect(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    ).toBeVisible();
  });

  it("focuses the world on the identity at the wheel", async () => {
    const mapRenderer = renderer();
    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
    });
    // The first fix moves the camera once on its own; focusing is the move a
    // person asks for, and it goes closer than that first fix does.
    await screen.findByRole("button", { name: "Map centred on this device" });
    const setCamera = vi.mocked(mapRenderer.setCamera);
    const firstFix = setCamera.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: "Focus the world on x0skai" }),
    );

    expect(setCamera.mock.calls.length).toBe(firstFix + 1);
    const [camera] = setCamera.mock.calls.at(-1) ?? [];
    expect(camera?.zoom).toBeGreaterThan(15);
  });

  it("focuses an Avaia at the wheel where it stands, not on its Bond", async () => {
    const avaiaAt = { longitude: 30.53, latitude: 50.455, bearingDeg: 0 };
    rememberWorld("0x0sky", { avaia: avaiaAt });
    const mapRenderer = renderer();
    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
    });
    await screen.findByRole("button", {
      name: /Focus the world on x0skai/,
    });
    await act(async () => undefined);
    const setCamera = vi.mocked(mapRenderer.setCamera);

    fireEvent.click(
      screen.getByRole("button", { name: "Focus the world on x0skai" }),
    );

    const [camera] = setCamera.mock.calls.at(-1) ?? [];
    expect(camera?.center).toEqual([avaiaAt.longitude, avaiaAt.latitude]);
  });

  it("comes in far enough to see the identity that just took the wheel", async () => {
    const mapRenderer = renderer();
    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
    });
    await screen.findByRole("button", { name: "Map centred on this device" });
    const setCamera = vi.mocked(mapRenderer.setCamera);
    const firstFix = setCamera.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );

    // The seats swap, and the camera lands at or inside the scale a body is
    // drawn from, so the arrival is something a person can watch happen.
    expect(
      screen.getByRole("button", { name: "Focus the world on 0x0sky" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Hand the wheel to x0skai" }),
    ).toBeVisible();
    expect(setCamera.mock.calls.length).toBe(firstFix + 1);
    const [camera] = setCamera.mock.calls.at(-1) ?? [];
    expect(camera?.zoom).toBeGreaterThanOrEqual(MAP_SCALE_ZOOM.street);
    expect(mapRenderer.unmount).not.toHaveBeenCalled();
  });

  it("brings the world to a body a person reached for", async () => {
    const mapRenderer = createMapRendererDouble({ kind: "ready" });
    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
    });
    await screen.findByRole("button", { name: "Map centred on this device" });
    const setCamera = vi.mocked(mapRenderer.setCamera);
    const firstFix = setCamera.mock.calls.length;

    act(() => mapRenderer.activateBody("bond"));

    expect(setCamera.mock.calls.length).toBe(firstFix + 1);
    const [camera] = setCamera.mock.calls.at(-1) ?? [];
    expect(camera?.zoom).toBeGreaterThan(MAP_SCALE_ZOOM.street);
    expect(mapRenderer.unmount).not.toHaveBeenCalled();
  });

  it("puts the Dock back on the pair when a body is reached for", () => {
    const mapRenderer = createMapRendererDouble({ kind: "ready" });
    const onNavigate = vi.fn();
    renderView({ mapRenderer, onNavigate, section: "settings" });

    act(() => mapRenderer.activateBody("bond"));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/");
  });
  it("opens the Bond edit surface from the Dock header", () => {
    const onNavigate = vi.fn();

    renderView({ onNavigate });
    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );
    const edit = screen.getByRole("button", { name: "Edit 0x0sky" });

    expect(edit).toHaveTextContent("edit");
    fireEvent.click(edit);

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/identity");
  });

  describe("the Dock's inventory action", () => {
    it.each([
      {
        seat: "bond" as const,
        standing: { level: 1, xp: 225, nextLevelXp: 400 },
        expected: 0.5,
      },
      {
        seat: "avaia" as const,
        standing: { level: 3, xp: 375, nextLevelXp: 450 },
        expected: 0.5,
      },
      {
        seat: "avaia" as const,
        standing: { level: 0, xp: 0, nextLevelXp: 0 },
        expected: 0,
      },
    ])(
      "fills by progress within the current $seat level",
      ({ seat, standing, expected }) => {
        expect(levelFill(standing, seat)).toBe(expected);
      },
    );

    const pending = () => new Promise<never>(() => undefined);
    const inventoryHost = {
      findItems: {
        applyInventoryCommand: vi.fn(pending),
        economyCatalog: vi.fn(pending),
      },
      committedAwards: {
        commitAwards: vi.fn(pending),
        readClaims: vi.fn(pending),
      },
    };

    it("sits left of edit only where the inventory can be kept", () => {
      const { unmount } = renderView();
      expect(
        screen.queryByRole("button", {
          name: "Status and inventory of x0skai",
        }),
      ).not.toBeInTheDocument();
      unmount();

      renderView(inventoryHost);
      const actions = [
        ...document.querySelectorAll(".bond-dock__header-actions button"),
      ].map((button) => button.getAttribute("aria-label"));
      expect(actions).toEqual([
        "Status and inventory of x0skai",
        "Edit x0skai",
      ]);
      const glyph = screen.getByRole("button", {
        name: "Status and inventory of x0skai",
      });
      expect(glyph).toHaveTextContent("");
      expect(glyph.querySelector("svg")).not.toBeNull();
    });

    it("opens what the driving Avaia carries, under its own state", () => {
      const { container } = renderView(inventoryHost);

      fireEvent.click(
        screen.getByRole("button", { name: "Status and inventory of x0skai" }),
      );

      const header = container.querySelector(".bond-dock__detail-header");
      expect(header).toHaveTextContent("Owned Avaia");
      expect(header?.querySelector("h2")).toHaveTextContent("Inventory");
      const state = screen.getByRole("region", { name: "x0skai" });
      expect(state).toHaveTextContent(/Level/);
      const grids = [
        ...container.querySelectorAll<HTMLElement>(".inventory__holder"),
      ].map((grid) => grid.dataset.holder);
      expect(grids).toEqual(["avaia", "bond"]);
    });

    it("opens the Bond's own when the Bond drives", () => {
      const { container } = renderView(inventoryHost);
      fireEvent.click(
        screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Status and inventory of 0x0sky" }),
      );

      expect(
        container.querySelector(".bond-dock__detail-header"),
      ).toHaveTextContent("Personal Bond");
      expect(screen.getByRole("region", { name: "0x0sky" })).toBeDefined();
      const grids = [
        ...container.querySelectorAll<HTMLElement>(".inventory__holder"),
      ].map((grid) => grid.dataset.holder);
      expect(grids).toEqual(["bond", "avaia"]);
    });
  });

  it("keeps the edit action to the world, where the Dock names the Bond", () => {
    renderView({ section: "identity" });

    expect(
      screen.queryByRole("button", { name: "Edit 0x0sky" }),
    ).not.toBeInTheDocument();
  });

  it("returns to the world from an identity surface", () => {
    const onNavigate = vi.fn();

    renderView({ section: "identity", onNavigate });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("presents the whole Bond profile on one identity surface", () => {
    renderView({
      section: "identity",
      slugEdit: createProfileSlugViewState("0x0sky", undefined, false),
    });

    expect(screen.getByRole("heading", { name: "0x0sky" })).toBeVisible();
    // Reading and changing the profile are the same screen.
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("pub_dress")).toHaveValue("sky");
    expect(screen.queryByLabelText("avaia")).not.toBeInTheDocument();
    expect(screen.getByText("Providers")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add a provider" }),
    ).toBeVisible();
    // Nothing a person cannot change is presented as something to edit.
    for (const absent of [
      "Age",
      "Home",
      "Family",
      "Closest Bond",
      "BondChains",
    ]) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
  });

  it("keeps a Dock screen's own name in the fixed header instead of duplicating it in the body", () => {
    const { container } = renderView({
      section: "identity",
      slugEdit: createProfileSlugViewState("0x0sky", undefined, false),
    });

    const headerTitle = container.querySelector(".bond-dock__detail-header h2");
    expect(headerTitle).toHaveTextContent(/^0x0sky$/);
    expect(screen.getAllByRole("heading", { name: "0x0sky" })).toHaveLength(1);

    // The header stays outside the scroller; the body starts with its content,
    // not another copy of the screen name.
    const scroll = container.querySelector<HTMLElement>(".bond-dock__scroll");
    expect(scroll).not.toBeNull();
    expect(scroll?.contains(headerTitle)).toBe(false);
    expect(
      container.querySelector(".bond-dock__detail-large-title"),
    ).toBeNull();
  });

  it("shows the owned Avaia address as the fixed header subtitle", () => {
    const { container } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "Edit x0skai" }));

    const header = container.querySelector(".bond-dock__detail-header");
    expect(header).toHaveTextContent("Owned Avaia");
    expect(header?.querySelector("h2")).toHaveTextContent(/^x0skai$/);
    expect(
      container.querySelector(".bond-dock__detail-large-title"),
    ).toBeNull();
  });

  it("lets an owned Avaia's header follow the section scrolled into", () => {
    const { container } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "Edit x0skai" }));

    const headerTitle = container.querySelector(".bond-dock__detail-header h2");
    const scroll = container.querySelector<HTMLElement>(".bond-dock__scroll");
    expect(scroll).not.toBeNull();
    const progress = [
      ...(scroll as HTMLElement).querySelectorAll<HTMLElement>(
        ".interface-settings__eyebrow",
      ),
    ].find((element) => element.textContent === "Progress");
    expect(progress).toBeDefined();
    const at = (element: Element, top: number, bottom: number) => {
      element.getBoundingClientRect = () =>
        ({ top, bottom, height: bottom - top }) as DOMRect;
    };
    const scrollTo = (top: number) => {
      Object.defineProperty(scroll, "scrollTop", {
        configurable: true,
        value: top,
      });
      fireEvent.scroll(scroll as HTMLElement);
    };
    at(scroll as HTMLElement, 100, 600);

    // Progress gone up under the header, it takes over the address's line…
    at(progress as HTMLElement, 40, 60);
    scrollTo(160);
    expect(headerTitle).toHaveTextContent(/^Progress$/);

    // …and back at the top, the address is the subtitle again.
    at(progress as HTMLElement, 120, 140);
    scrollTo(0);
    expect(headerTitle).toHaveTextContent(/^x0skai$/);
  });

  it("lets the header say the section a person has scrolled into, and the screen above the first", () => {
    const { container } = renderView({ section: "settings" });
    const scroll = container.querySelector<HTMLElement>(".bond-dock__scroll");
    const headerTitle = container.querySelector(".bond-dock__detail-header h2");
    expect(scroll).not.toBeNull();
    const at = (element: Element, top: number, bottom: number) => {
      element.getBoundingClientRect = () =>
        ({ top, bottom, height: bottom - top }) as DOMRect;
    };
    const legend = (name: string) => {
      const found = [
        ...(scroll as HTMLElement).querySelectorAll("legend"),
      ].find((element) => element.textContent === name);
      expect(found).toBeDefined();
      return found as HTMLElement;
    };
    const scrollTo = (top: number) => {
      Object.defineProperty(scroll, "scrollTop", {
        configurable: true,
        value: top,
      });
      fireEvent.scroll(scroll as HTMLElement);
    };
    at(scroll as HTMLElement, 100, 600);

    // Before the first section passes, the fixed subtitle names the screen.
    at(legend("Language"), 120, 140);
    scrollTo(40);
    expect(headerTitle).toHaveTextContent(/^Settings$/);
    expect(headerTitle).not.toHaveAttribute("aria-hidden");

    // Its title gone up under the header, the section takes over saying it…
    at(legend("Language"), 40, 60);
    at(legend("Appearance"), 200, 220);
    scrollTo(160);
    expect(headerTitle).toHaveTextContent(/^Language$/);

    // …and the last one gone up is the one being read.
    at(legend("Appearance"), 60, 80);
    scrollTo(320);
    expect(headerTitle).toHaveTextContent(/^Appearance$/);

    // Back at the top, the sections move back below the fixed header and the
    // screen name takes the subtitle again.
    at(legend("Language"), 120, 140);
    at(legend("Appearance"), 260, 280);
    scrollTo(0);
    expect(headerTitle).not.toHaveAttribute("aria-hidden");
    expect(headerTitle).toHaveTextContent(/^Settings$/);
  });

  it("opens the Providers screen from add, with a connect route each", () => {
    renderView({ section: "identity" });

    fireEvent.click(screen.getByRole("button", { name: "Add a provider" }));

    expect(screen.getByRole("heading", { name: "Providers" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Connect Telegram" }),
    ).toHaveAttribute("href", "/auth?provider=telegram&intent=connect");
    expect(
      screen.getByRole("link", { name: "Connect Discord" }),
    ).toHaveAttribute("href", "/auth?provider=discord&intent=connect");
    expect(
      screen.getByRole("link", { name: "Connect GitHub" }),
    ).toHaveAttribute("href", "/auth?provider=github&intent=connect");
    expect(screen.getAllByText("Not connected")).toHaveLength(3);
  });

  it("assigns no study, draws no fallback body, and offers the four in the editor", async () => {
    const onAvatarChoice = vi.fn(async () => undefined);
    const mapRenderer = renderer();
    renderView({
      section: "identity",
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState(undefined, undefined),
      onAvatarChoice,
    });

    expect(
      screen.getByText(/no avatar is drawn until you choose/i),
    ).toBeVisible();
    await screen.findByRole("button", { name: "Map centred on this device" });
    expect(mapRenderer.avatars).toBeDefined();
    expect(vi.mocked(mapRenderer.avatars!.upsert)).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /Choose your 3D model/ }),
    );

    for (const name of ["Sky", "Dasha", "Kai", "Dasha 2.0"]) {
      expect(
        screen.getByRole("radio", {
          name: new RegExp(`${name}(?! 2\\.0)`),
        }),
      ).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("radio", { name: /Dasha(?! 2\.0)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(onAvatarChoice).toHaveBeenCalledExactlyOnceWith("dasha-study"),
    );
  });

  it("reports a newer stored study without substituting another body", () => {
    renderView({
      section: "identity",
      avatarChoice: createAvatarChoiceViewState(
        "future-study" as AvatarModel,
        undefined,
      ),
    });

    expect(
      screen.getByText(/future-study, which this client cannot display/i),
    ).toBeVisible();
    // A stored study this client cannot draw is not replaced by one it can:
    // the field says nothing was chosen here rather than naming another body.
    expect(
      screen.getByRole("button", { name: /Choose your 3D model/ }),
    ).toBeInTheDocument();
  });

  it("names the chosen study on the field, and opens the editor on it", () => {
    renderView({
      section: "identity",
      avatarChoice: createAvatarChoiceViewState("sky-study", undefined),
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Change your 3D model — currently Sky/,
      }),
    );

    expect(screen.getByRole("radio", { name: /Sky/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    // A sculpted study has no wardrobe, and says so rather than offering one.
    expect(screen.getByText(/one sculpted study/i)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Hair" })).toBeNull();
  });

  it("leaves an untouched editor at once, and asks once before the way back discards a change", () => {
    renderView({
      section: "identity",
      avatarChoice: createAvatarChoiceViewState("sky-study", undefined),
    });
    const openEditor = () =>
      fireEvent.click(
        screen.getByRole("button", {
          name: /Change your 3D model — currently Sky/,
        }),
      );

    // Nothing changed: back is just back.
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("radio", { name: /Sky/ })).toBeNull();

    // A changed draft is not thrown away by navigation alone…
    openEditor();
    fireEvent.click(screen.getByRole("radio", { name: /Kai/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your changes to this 3D model are not saved.",
    );
    const keepEditing = screen.getByRole("button", { name: "Keep editing" });
    expect(keepEditing).toHaveFocus();

    // …staying keeps every choice…
    fireEvent.click(keepEditing);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("radio", { name: /Kai/ })).toBeChecked();

    // …and asked again, back leaves without saving.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("radio", { name: /Kai/ })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /Change your 3D model — currently Sky/,
      }),
    ).toBeInTheDocument();
  });

  it("takes the leave prompt away once Save is pressed, so a pending save cannot be discarded", async () => {
    let answer: (result: undefined) => void = () => undefined;
    const onAvatarChoice = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          answer = resolve;
        }),
    );
    renderView({
      section: "identity",
      avatarChoice: createAvatarChoiceViewState("sky-study", undefined),
      onAvatarChoice,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Change your 3D model — currently Sky/,
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Kai/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onAvatarChoice).toHaveBeenCalledExactlyOnceWith("kai-study");

    // While the service is still answering, nothing offers to throw the
    // model away: the prompt is gone and Cancel waits with Save.
    expect(
      screen.queryByRole("button", { name: "Discard changes" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    answer(undefined);
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled(),
    );
    // A refused save leaves the editor and its draft where they were.
    expect(screen.getByRole("radio", { name: /Kai/ })).toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Discard changes" }),
    ).toBeNull();
  });

  // Skipped along with the wardrobe sections themselves: avatar-editor-view.tsx
  // hides them for now because equipping an item does not persist. Model-level
  // equip logic stays covered in avatar-editor-view-model.test.ts; unskip this
  // once the sections come back.
  it.skip("offers Dasha 2.0's wardrobe, and only hers", () => {
    renderView({
      section: "identity",
      avatarChoice: createAvatarChoiceViewState("dasha-v2-study", undefined),
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Change your 3D model — currently Dasha 2\.0/,
      }),
    );

    expect(screen.getByRole("heading", { name: "Hair" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Black tee" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Silver earrings" }),
    ).toBeChecked();

    // A dress is the whole garment: the separates come off in the same change.
    fireEvent.click(screen.getByRole("radio", { name: "Indigo shift" }));
    expect(screen.getByRole("radio", { name: "Indigo shift" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Black tee" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    // Cancel puts back exactly what was saved.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /Change your 3D model — currently Dasha 2\.0/,
      }),
    );
    expect(screen.getByRole("radio", { name: "Black tee" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Indigo shift" }),
    ).not.toBeChecked();
  });

  // Skipped with the wardrobe sections above: this exercises equipping
  // through the now-hidden UI. Unskip once the sections come back.
  it.skip("keeps a saved outfit across a reload, and draws it on the world", async () => {
    const mapRenderer = renderer();
    const view = renderView({
      section: "identity",
      avatarChoice: createAvatarChoiceViewState("dasha-v2-study", undefined),
      onAvatarChoice: vi.fn(async () => undefined),
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Change your 3D model — currently Dasha 2\.0/,
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Loose length" }));
    fireEvent.click(screen.getByRole("radio", { name: "White sneakers" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Change your 3D model/ }),
      ).toBeInTheDocument(),
    );
    view.unmount();

    renderView({
      section: "identity",
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState("dasha-v2-study", undefined),
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Change your 3D model — currently Dasha 2\.0/,
      }),
    );
    expect(screen.getByRole("radio", { name: "Loose length" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "White sneakers" })).toBeChecked();
    cleanup();

    // The world draws the same outfit the editor is showing, once the Bond
    // wearing it takes the wheel from its Avaia.
    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState("dasha-v2-study", undefined),
    });
    await screen.findByRole("button", { name: "Map centred on this device" });
    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );
    const bondHandle = () =>
      vi
        .mocked(mapRenderer.avatars!.upsert)
        .mock.calls.map(([drawn]) => drawn)
        .findLast((drawn) => drawn.id === "bond");
    await vi.waitFor(() => expect(bondHandle()).toBeDefined(), {
      timeout: 5_000,
    });
    const handle = bondHandle();
    expect(handle?.visibleNodes).toContain("wear:hair/loose-long");
    expect(handle?.visibleNodes).toContain("wear:shoes/sneakers-white");
    expect(handle?.visibleNodes).not.toContain("wear:shoes/loafers-black");
  });

  // Regression: useAvatarSelection used to let the ambient default it was
  // handed always win over a choice this device actually remembered, so an
  // Avaia's own saved body silently reverted to the deterministic default on
  // every render. This exercises the whole path a person actually uses —
  // the field, the editor, Save — and checks the world, not just the field.
  it("keeps the body chosen for an Avaia, over its own ambient default", async () => {
    const mapRenderer = createMapRendererDouble({ kind: "ready" });
    const avaiaSetup = createAvaiaSetupViewState({
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
    renderView({
      mapRenderer,
      avaiaSetup,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
    });
    await screen.findByRole("button", { name: "Map centred on this device" });

    const avaiaHandle = () =>
      vi
        .mocked(mapRenderer.avatars!.upsert)
        .mock.calls.map(([drawn]) => drawn)
        .findLast((drawn) => drawn.id === "avaia");

    // Nothing chosen yet: the world draws the deterministic ambient study for
    // this address ("Dasha 2.0", for "x0skai" against a "dasha-study" Bond).
    await vi.waitFor(() =>
      expect(avaiaHandle()?.modelId).toBe(avaiaStudy("x0skai", "dasha-study")),
    );
    expect(avaiaHandle()?.modelId).not.toBe("kai-study");

    fireEvent.click(screen.getByRole("button", { name: "Edit x0skai" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /Change this Avaia's 3D model — currently Dasha 2\.0/,
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Kai/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The field itself reads back the saved choice…
    expect(
      await screen.findByRole("button", {
        name: /Change this Avaia's 3D model — currently Kai/,
      }),
    ).toBeVisible();
    // …and so does the world: not the ambient default, whatever it computes to.
    await vi.waitFor(() => expect(avaiaHandle()?.modelId).toBe("kai-study"));

    // The card carries the same choice once the body is too far to read.
    const label = vi.mocked(mapRenderer.setObservedPositionLabel).mock
      .lastCall?.[0];
    expect(label?.avatarUrl).toBe(avatarPreviewUrl("kai-study"));
  });

  it("shows connected providers as marks that open the external account", () => {
    renderView({
      section: "identity",
      connectedProviders: [
        { provider: "telegram", handle: "zerosky" },
        { provider: "discord", externalId: "84759302847591038" },
      ],
    });

    const telegram = screen.getByRole("link", { name: "Open Telegram" });
    expect(telegram).toHaveTextContent("TG");
    expect(telegram).toHaveAttribute("href", "https://t.me/zerosky");
    expect(telegram).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Open Discord" })).toHaveAttribute(
      "href",
      "https://discord.com/users/84759302847591038",
    );
    // The compact surface carries no account text at all.
    expect(screen.queryByText("zerosky")).not.toBeInTheDocument();
  });

  it("hands a provider scheme to a host that can follow one", () => {
    renderView({
      section: "identity",
      providerDeepLinks: ["telegram"],
      connectedProviders: [{ provider: "telegram", handle: "zerosky" }],
    });

    const telegram = screen.getByRole("link", { name: "Open Telegram" });
    expect(telegram).toHaveAttribute("href", "tg://resolve?domain=zerosky");
    expect(telegram).not.toHaveAttribute("target");
  });

  it("falls back to the provider itself for an address it does not know", () => {
    renderView({
      section: "identity",
      connectedProviders: [{ provider: "telegram" }],
    });

    expect(screen.getByRole("link", { name: "Open Telegram" })).toHaveAttribute(
      "href",
      "https://t.me",
    );
  });

  it("edits only the Bond address on the Personal Bond surface", () => {
    const onSlugChange = vi.fn();
    renderView({
      section: "identity",
      slugEdit: createProfileSlugViewState("0x0sky", undefined, false),
      onSlugChange,
    });

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(screen.queryByLabelText("avaia")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("pub_dress"), {
      target: { value: "rain" },
    });

    expect(onSlugChange).toHaveBeenCalledExactlyOnceWith("rain");
  });

  it("saves a changed slug and reports what the service answered", () => {
    const onSlugSubmit = vi.fn();
    const { rerender } = renderView({
      section: "identity",
      slugEdit: createProfileSlugViewState("0x0sky", "rain", false),
      onSlugSubmit,
    });

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSlugSubmit).toHaveBeenCalledOnce();

    rerender(
      <AuthenticatedMapHomeView
        hostLabel="browser host"
        pubDress="0x0sky"
        avaiaPubDress="x0skai"
        renderer={renderer()}
        geolocation={UNSUPPORTED_GEOLOCATION_DOUBLE}
        runtime={{
          tone: "ready",
          label: "Shared Core ready",
          detail: "Contract 0.1.0 is available to the Web client.",
        }}
        safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
        section="identity"
        slugEdit={createProfileSlugViewState("0x0sky", "rain", false, {
          kind: "rejected",
          reason: "unavailable",
        })}
        onSlugSubmit={onSlugSubmit}
      />,
    );

    expect(
      screen.getByText("That address belongs to another Bond."),
    ).toBeVisible();
  });

  it("manages connected and unconnected providers on one screen", () => {
    const onDisconnectProvider = vi.fn();
    renderView({
      section: "identity",
      connectedProviders: [{ provider: "telegram", handle: "zerosky" }],
      onDisconnectProvider,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add a provider" }));

    expect(screen.getByRole("heading", { name: "Providers" })).toBeVisible();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.getAllByText("Not connected")).toHaveLength(2);
    // Connected: reachable and detachable. Unconnected: connectable.
    expect(screen.getByRole("link", { name: "Open Telegram" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Connect Telegram" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Discord" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Connect GitHub" })).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disconnect Telegram from this Bond",
      }),
    );

    expect(onDisconnectProvider).toHaveBeenCalledExactlyOnceWith("telegram");
  });

  it("says a disconnect never reaches the external account", () => {
    renderView({
      section: "identity",
      connectedProviders: [{ provider: "telegram" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add a provider" }));

    expect(
      screen.getByText(/never deletes the account on the provider/),
    ).toBeVisible();
  });

  it("presents the settings dock and sign-out in Ukrainian", () => {
    chooseLocale("uk-UA");
    const onLogout = vi.fn();
    renderView({ section: "settings", onLogout });

    expect(screen.getByRole("heading", { name: "Налаштування" })).toBeVisible();
    expect(screen.getByText("Застосунок")).toBeVisible();
    expect(screen.getByText("Вигляд")).toBeVisible();
    expect(screen.getByText("Залишити мапу світлою")).toBeVisible();
    expect(screen.getByText("Глибина")).toBeVisible();
    expect(screen.getByText("Піднімати будівлі при наближенні")).toBeVisible();
    expect(screen.getByText("Залишати будівлі контурами")).toBeVisible();
    expect(
      screen.getByText(/не змінює стан Bond, BondChain чи спільного Core/),
    ).toBeVisible();
    expect(screen.getByText("хост браузера")).toBeVisible();
    expect(screen.getByText("Спільний Core готовий")).toBeVisible();
    expect(screen.getByText("контракт 0.1.0")).toBeVisible();
    expect(screen.getByRole("button", { name: "Назад" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Більше" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Вийти" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("presents appearance on the settings route and persists it locally", () => {
    const { container } = renderView({ section: "settings" });

    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Auto/i })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Light/i }));

    expect(screen.getByRole("radio", { name: /Light/i })).toBeChecked();
    expect(container.querySelector(".authenticated-map-home")).toHaveAttribute(
      "data-theme",
      "light",
    );
    expect(window.localStorage.getItem("nilx-one.interface.appearance")).toBe(
      "light",
    );
  });

  it("offers sound on the settings route and keeps the choice on this device", () => {
    const sound = soundDouble();
    renderView({ section: "settings", sound });

    expect(screen.getByRole("group", { name: "Sound" })).toBeVisible();
    expect(
      screen.getByRole("radio", { name: /^Effects\s?A short/ }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Effects and world/ }));

    expect(window.localStorage.getItem("nilx-one.interface.sound")).toBe("all");
    // Character voices default to cutscenes: the middle of three stops.
    const voices = screen.getByRole("slider", { name: /Character voices/ });
    expect(voices).toHaveValue("1");
    expect(voices).toHaveAttribute("aria-valuetext", "Cutscenes");
    fireEvent.change(voices, { target: { value: "2" } });
    expect(window.localStorage.getItem("nilx-one.interface.voice")).toBe("all");
    expect(voices).toHaveAttribute("aria-valuetext", "Everything");
    // The choice is the gesture a browser opens audio from, so the host is
    // told at once and the person hears what they turned on.
    expect(sound.setEnabled).toHaveBeenCalledWith(true);
    expect(sound.play).toHaveBeenCalledWith("tap");
  });

  it("rests character voices at off, and waits, while sound itself is off", () => {
    window.localStorage.setItem("nilx-one.interface.sound", "off");
    window.localStorage.setItem("nilx-one.interface.voice", "all");
    renderView({ section: "settings", sound: soundDouble() });
    const voices = screen.getByRole("slider", { name: /Character voices/ });
    expect(voices).toBeDisabled();
    expect(voices).toHaveValue("0");
    // The stored choice is kept for when sound comes back.
    expect(window.localStorage.getItem("nilx-one.interface.voice")).toBe("all");
  });

  it("offers no sound choice on a host that cannot make one", () => {
    renderView({
      section: "settings",
      sound: { ...soundDouble(), supported: false },
    });
    expect(screen.queryByRole("group", { name: "Sound" })).toBeNull();
  });

  it("hears the world in view only once the person asks for it", async () => {
    const sound = soundDouble();
    renderView({ sound });
    await act(async () => undefined);
    expect(sound.setAmbience).not.toHaveBeenCalledWith(
      expect.objectContaining({ presence: expect.any(Number) }),
    );

    window.localStorage.setItem("nilx-one.interface.sound", "all");
    cleanup();
    renderView({ sound });
    await act(async () => undefined);
    expect(sound.setAmbience).toHaveBeenCalledWith(
      expect.objectContaining({ presence: expect.any(Number) }),
    );
  });

  it("resolves the appearance before the renderer paints its first style", () => {
    window.localStorage.setItem("nilx-one.interface.appearance", "dark");
    const mapRenderer = renderer();

    renderView({ mapRenderer });

    expect(mapRenderer.setAppearance).toHaveBeenCalledWith("dark");

    const [appearanceCall] = vi.mocked(mapRenderer.setAppearance).mock
      .invocationCallOrder;
    const [mountCall] = vi.mocked(mapRenderer.mount).mock.invocationCallOrder;
    expect(appearanceCall).toBeDefined();
    expect(mountCall).toBeDefined();
    expect(appearanceCall ?? 0).toBeLessThan(mountCall ?? 0);
  });

  // A device that never asked for dark must not be given it. The world opens
  // in the same light the sign-in surface was painted in.
  it("opens light when neither a choice nor the device asks for dark", () => {
    const mapRenderer = renderer();

    const { container } = renderView({ mapRenderer });

    expect(mapRenderer.setAppearance).toHaveBeenCalledWith("light");
    expect(container.querySelector(".authenticated-map-home")).toHaveAttribute(
      "data-theme",
      "light",
    );
  });

  it("forwards an appearance change as renderer presentation state", () => {
    const mapRenderer = renderer();

    renderView({ mapRenderer, section: "settings" });
    fireEvent.click(screen.getByRole("radio", { name: /Light/i }));

    expect(mapRenderer.setAppearance).toHaveBeenLastCalledWith("light");
    expect(mapRenderer.mount).toHaveBeenCalledOnce();
    expect(mapRenderer.unmount).not.toHaveBeenCalled();
  });

  it("keeps a rendering map free of status chrome", () => {
    renderView({ mapRenderer: renderer({ kind: "ready" }) });

    expect(screen.queryByText("Map unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading map")).not.toBeInTheDocument();
  });

  it.each([
    [
      "style-load-failed",
      "The versioned self-hosted map style is not published yet.",
    ],
    [
      "basemap-load-failed",
      "The versioned self-hosted basemap archive could not be read.",
    ],
    [
      "renderer-init-failed",
      "The map renderer could not be created on this client.",
    ],
    [
      "first-paint-timeout",
      "The map style loaded, but the renderer never drew a first frame.",
    ],
    [
      "webgl-unavailable",
      "This browser could not create the WebGL2 context the map needs.",
    ],
  ])("names a %s failure instead of showing an empty map", (reason, detail) => {
    renderView({ mapRenderer: renderer({ kind: "unavailable", reason }) });

    expect(screen.getByText("Map unavailable")).toBeVisible();
    expect(screen.getByText(detail)).toBeVisible();
  });

  it("reports renderer status through the toast stack, never the Dock", () => {
    const { container } = renderView({
      mapRenderer: renderer({ kind: "loading" }),
    });

    const toasts = container.querySelector<HTMLElement>(".app-shell__toasts");
    expect(toasts).not.toBeNull();
    expect(
      within(toasts as HTMLElement).getByText("Loading map"),
    ).toBeVisible();
    expect(within(dock(container)).queryByText("Loading map")).toBeNull();
  });

  it("subscribes to renderer status so a late failure still surfaces", () => {
    const mapRenderer = renderer({ kind: "loading" });

    renderView({ mapRenderer });

    expect(mapRenderer.subscribe).toHaveBeenCalledOnce();
    expect(screen.getByText("Loading map")).toBeVisible();
  });

  it("exposes host actions through the header overflow menu", () => {
    const onLogout = vi.fn();

    renderView({ onLogout });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("recenters through the host capability instead of a browser API", async () => {
    const mapRenderer = renderer();
    const geolocation = createGeolocationDouble({ position: observation() });

    renderView({ mapRenderer, geolocation });
    await screen.findByRole("button", { name: "Map centred on this device" });

    // The observation reaches the renderer as presentation geometry; the
    // renderer was never asked to acquire it.
    expect(mapRenderer.setObservedPosition).toHaveBeenCalledWith({
      center: [30.5234, 50.4501],
      accuracyMeters: 24,
    });
    expect(mapRenderer.setCamera).toHaveBeenCalledOnce();
    expect(geolocation.requestPosition).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: "Map centred on this device" }),
    );

    // Recentering reuses the observation it already holds.
    expect(geolocation.requestPosition).toHaveBeenCalledOnce();
    expect(mapRenderer.setCamera).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Map camera focused near this device."),
    ).toBeInTheDocument();
  });

  // Focusing an identity is the moment a person expects to see somebody. A
  // body is drawn at true human height, never larger than life, so this covers
  // the whole path: the camera arrives close enough to read it, and it
  // withdraws again when the world pulls back to where an observation is a
  // place rather than a person.
  it("draws a readable body at close range and withdraws it when the world pulls back", async () => {
    const mapRenderer = createMapRendererDouble({ kind: "ready" });

    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
    });
    await screen.findByRole("button", { name: "Map centred on this device" });

    const upsert = vi.mocked(mapRenderer.avatars!.upsert);
    expect(upsert).toHaveBeenCalled();

    act(() => {
      mapRenderer.moveCamera(
        { ...mapRenderer.getCamera(), zoom: MAP_BODY_HANDOVER_ZOOM },
        true,
      );
    });

    const close = upsert.mock.lastCall?.[0];
    expect(close).toMatchObject({ visible: true, scale: 1 });

    act(() => {
      mapRenderer.moveCamera(
        { ...mapRenderer.getCamera(), zoom: MAP_SCALE_ZOOM.city },
        true,
      );
    });

    expect(upsert.mock.lastCall?.[0].visible).toBe(false);
  });

  // Authentication starts with the Avaia at the wheel, in the study its Bond's
  // choice gives it, so the first body is drawn without waiting for a
  // presentation handover to repair which identity the world is drawing.
  it("draws the Avaia's study immediately after authentication", async () => {
    const mapRenderer = createMapRendererDouble({ kind: "ready" });

    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      avaiaAvailability: "unavailable",
    });
    await screen.findByRole("button", { name: "Map centred on this device" });

    const drawn = vi
      .mocked(mapRenderer.avatars!.upsert)
      .mock.calls.map(([handle]) => handle);
    expect(new Set(drawn.map((handle) => handle.id))).toEqual(
      new Set(["avaia"]),
    );
    expect(drawn.at(-1)?.modelId).toBe(avaiaStudy("x0skai", "dasha-study"));
    // The seat nobody is in is dropped rather than left standing behind.
    expect(vi.mocked(mapRenderer.avatars!.remove)).toHaveBeenCalledWith("bond");
  });

  it("settles the leaving body before the arriving one, rather than swapping", async () => {
    // The avatar effect has an unrelated ambient interval. With real timers,
    // its queued callback can land after mockClear() but before React commits
    // the click-driven handover effect, making an ambient clip look like the
    // first post-click handover draw. Own the clock here instead of racing it.
    vi.useFakeTimers();
    const mapRenderer = createMapRendererDouble({ kind: "ready" });

    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      avaiaAvailability: "ready",
    });
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Map centred on this device" }),
      ).toBeVisible(),
    );

    const upsert = vi.mocked(mapRenderer.avatars!.upsert);
    upsert.mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );

    // The Avaia does not blink away: it settles first, and only then does the
    // Bond come out and wake on the world.
    const first = upsert.mock.calls[0]?.[0];
    expect(first).toMatchObject({ id: "avaia", clipId: "quiesce" });
    expect(first?.clipPhase).toBeLessThan(1);
  });

  // Far out the body is gone and the card is what is left, so it has to carry
  // the same study — the identity at the wheel, not the one spectating.
  it("gives the card the study of whoever is at the wheel", async () => {
    const mapRenderer = createMapRendererDouble({ kind: "ready" });

    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      avaiaAvailability: "ready",
    });
    await screen.findByRole("button", { name: "Map centred on this device" });

    const label = vi.mocked(mapRenderer.setObservedPositionLabel).mock
      .lastCall?.[0];
    const drawn = vi.mocked(mapRenderer.avatars!.upsert).mock.lastCall?.[0]
      .modelId;

    expect(label).toMatchObject({ title: "x0skai", detail: "This device" });
    expect(label?.avatarUrl).toBe(avatarPreviewUrl(drawn!));
    expect(drawn).toBe(avaiaStudy("x0skai", "dasha-study"));
  });

  // The card names whoever took the wheel — an Avaia that hands back to its
  // Bond is spectating, and the marker it left behind must say so too.
  it("renames the card to the Bond once it takes the wheel", async () => {
    const mapRenderer = createMapRendererDouble({ kind: "ready" });

    renderView({
      mapRenderer,
      geolocation: createGeolocationDouble({ position: observation() }),
      avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      avaiaAvailability: "ready",
    });
    await screen.findByRole("button", { name: "Map centred on this device" });

    fireEvent.click(
      screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
    );

    const label = vi.mocked(mapRenderer.setObservedPositionLabel).mock
      .lastCall?.[0];
    expect(label).toMatchObject({ title: "0x0sky", detail: "This device" });
  });

  describe("an Avaia at the wheel", () => {
    const here = observation();
    // About 70 m east of this device.
    const there = {
      longitude: here.longitude + 0.001,
      latitude: here.latitude,
    };

    async function renderWorld(overrides: ViewOverrides = {}) {
      vi.useFakeTimers();
      const mapRenderer = createMapRendererDouble({ kind: "ready" });
      renderView({
        mapRenderer,
        geolocation: createGeolocationDouble({ position: here }),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
        ...overrides,
      });
      // A remembered Avaia can centre the camera away from the Bond. Readiness
      // means the observation reached the renderer, not a centred camera button.
      await vi.waitFor(() =>
        expect(mapRenderer.setObservedPosition).toHaveBeenCalledWith({
          center: [here.longitude, here.latitude],
          accuracyMeters: here.accuracyMeters,
        }),
      );
      return mapRenderer;
    }

    const voice = avaiaStudy("x0skai", "dasha-study");
    const lastLabel = (mapRenderer: MapRenderer) =>
      vi.mocked(mapRenderer.setObservedPositionLabel).mock.lastCall?.[0];
    const lastAvaia = (mapRenderer: MapRenderer) =>
      vi
        .mocked(mapRenderer.avatars!.upsert)
        .mock.calls.map(([handle]) => handle)
        .findLast((handle) => handle.id === "avaia");

    it("keeps Avaia at A through a Bond-at-B round trip and handover", async () => {
      rememberWorld("0x0sky", { avaia: { ...there, bearingDeg: 90 } });
      const mapRenderer = await renderWorld();
      expect(lastAvaia(mapRenderer)?.lngLat).toEqual([
        there.longitude,
        there.latitude,
      ]);
      fireEvent.click(
        screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
      );
      // The departing Avaia also retains A during its handover animation.
      expect(lastAvaia(mapRenderer)?.lngLat).toEqual([
        there.longitude,
        there.latitude,
      ]);
      act(() => vi.advanceTimersByTime(2_000));
      fireEvent.click(
        screen.getByRole("button", { name: "Hand the wheel to x0skai" }),
      );
      expect(lastLabel(mapRenderer)?.at).toEqual([
        there.longitude,
        there.latitude,
      ]);
      const camera = vi.mocked(mapRenderer.setCamera).mock.lastCall?.[0];
      expect(camera?.center).toEqual([there.longitude, there.latitude]);
      act(() => vi.advanceTimersByTime(2_000));
      expect(lastAvaia(mapRenderer)?.lngLat).toEqual([
        there.longitude,
        there.latitude,
      ]);
      expect(readWorldMemory("0x0sky").avaia).toMatchObject(there);
    });

    it("uses the frozen mid-walk point for the returning body, label and camera", async () => {
      const mapRenderer = await renderWorld();
      act(() =>
        (
          mapRenderer as ReturnType<typeof renderer> & {
            tapGround: (tap: object) => void;
          }
        ).tapGround({ ...there, ground: "open" }),
      );
      act(() => vi.advanceTimersByTime(10_000));
      fireEvent.click(
        screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
      );
      const frozen = readWorldMemory("0x0sky").avaia!;
      expect(frozen.longitude).toBeGreaterThan(here.longitude);
      expect(frozen.longitude).toBeLessThan(there.longitude);
      expect(lastAvaia(mapRenderer)?.lngLat).toEqual([
        frozen.longitude,
        frozen.latitude,
      ]);
      act(() => vi.advanceTimersByTime(2_000));
      fireEvent.click(
        screen.getByRole("button", { name: "Hand the wheel to x0skai" }),
      );
      expect(
        vi.mocked(mapRenderer.setCamera).mock.lastCall?.[0].center,
      ).toEqual([frozen.longitude, frozen.latitude]);
      expect(lastLabel(mapRenderer)?.at).toEqual([
        frozen.longitude,
        frozen.latitude,
      ]);
      act(() => vi.advanceTimersByTime(2_000));
      expect(lastAvaia(mapRenderer)?.lngLat).toEqual([
        frozen.longitude,
        frozen.latitude,
      ]);
      expect(readWorldMemory("0x0sky").avaia).toEqual(frozen);
    });

    it("walks where its owner taps, and says so on its card", async () => {
      const mapRenderer = await renderWorld();

      act(() =>
        (
          mapRenderer as ReturnType<typeof renderer> & {
            tapGround: (tap: object) => void;
          }
        ).tapGround({ ...there, ground: "open" }),
      );

      const speaking = lastLabel(mapRenderer)?.speech;
      expect(avaiaLines("en", voice, "walk")).toContain(speaking);
      expect(
        screen.getByText(speaking!, { selector: ".visually-hidden" }),
      ).toBeInTheDocument();
      // Mid-walk the body strides, facing the way it is going.
      act(() => vi.advanceTimersByTime(200));
      expect(lastAvaia(mapRenderer)).toMatchObject({ clipId: "walk" });
      expect(lastAvaia(mapRenderer)?.bearingDeg).toBeCloseTo(90, 0);

      act(() => vi.advanceTimersByTime(60_000));
      const arrived = lastAvaia(mapRenderer);
      expect(arrived?.lngLat[0]).toBeCloseTo(there.longitude, 6);
      expect(arrived?.lngLat[1]).toBeCloseTo(there.latitude, 6);
      // The card went with it, and says how far that is from this device.
      const card = lastLabel(mapRenderer);
      expect(card?.at?.[0]).toBeCloseTo(there.longitude, 6);
      expect(card?.detail).toMatch(/^\d+ m from this device$/);
      // And the line has been said: the card closes again.
      expect(card?.speech).toBeUndefined();
      expect(SPEECH_MS).toBe(10_000);
    });

    it("says why not, and stays, when the ground is not walkable", async () => {
      const mapRenderer = await renderWorld();

      act(() =>
        (
          mapRenderer as ReturnType<typeof renderer> & {
            tapGround: (tap: object) => void;
          }
        ).tapGround({ ...there, ground: "building" }),
      );
      act(() => vi.advanceTimersByTime(5_000));

      expect(avaiaLines("en", voice, "blocked.building")).toContain(
        lastLabel(mapRenderer)?.speech,
      );
      expect(lastAvaia(mapRenderer)?.lngLat).toEqual([
        here.longitude,
        here.latitude,
      ]);
    });

    // A box of ground `x0`..`x1`, `y0`..`y1` in degrees off this device, as
    // the renderer would hand a footprint over.
    const footprint = (x0: number, y0: number, x1: number, y1: number) => [
      [
        [here.longitude + x0, here.latitude + y0],
        [here.longitude + x1, here.latitude + y0],
        [here.longitude + x1, here.latitude + y1],
        [here.longitude + x0, here.latitude + y1],
        [here.longitude + x0, here.latitude + y0],
      ] as [number, number][],
    ];
    const tap = (mapRenderer: MapRenderer, ground = "open") =>
      act(() =>
        (
          mapRenderer as ReturnType<typeof renderer> & {
            tapGround: (tap: object) => void;
          }
        ).tapGround({ ...there, ground }),
      );

    it("is heard setting off and walking, and silent once it arrives", async () => {
      const sound = soundDouble();
      const mapRenderer = await renderWorld({ sound });
      sound.play.mockClear();

      tap(mapRenderer);
      expect(sound.play).toHaveBeenCalledWith("walk");

      act(() => vi.advanceTimersByTime(1_300));
      const steps = () =>
        sound.play.mock.calls.filter(([cue]) => cue === "step").length;
      expect(steps()).toBeGreaterThanOrEqual(2);

      act(() => vi.advanceTimersByTime(60_000));
      const arrived = steps();
      act(() => vi.advanceTimersByTime(5_000));
      expect(steps()).toBe(arrived);
    });

    it("says its walking line aloud only when every character speaks", async () => {
      window.localStorage.setItem("nilx-one.interface.voice", "all");
      const sound = soundDouble();
      const mapRenderer = await renderWorld({ sound });

      tap(mapRenderer);

      const said = lastLabel(mapRenderer)?.speech;
      expect(said).toBeDefined();
      const url = avaiaVoiceUrl({
        locale: "en",
        model: voice,
        kind: "walk",
        text: said!,
      });
      expect(url).toMatch(/^\/voices\/.+\/en\/.+\/walk\.\d\.mp3$/);
      expect(sound.speak).toHaveBeenCalledWith({ url });
    });

    it.each(["off", "cutscenes"])(
      "keeps its walking lines to itself when voices are at %s",
      async (level) => {
        window.localStorage.setItem("nilx-one.interface.voice", level);
        const sound = soundDouble();
        const mapRenderer = await renderWorld({ sound });

        tap(mapRenderer);

        expect(lastLabel(mapRenderer)?.speech).toBeDefined();
        expect(sound.play).toHaveBeenCalledWith("walk");
        expect(sound.speak).not.toHaveBeenCalled();
      },
    );

    it("is heard refusing ground it cannot walk onto", async () => {
      const sound = soundDouble();
      const mapRenderer = await renderWorld({ sound });
      sound.play.mockClear();

      tap(mapRenderer, "water");

      expect(sound.play).toHaveBeenCalledWith("refuse");
      expect(sound.play).not.toHaveBeenCalledWith("walk");
    });

    it("walks around a building that stands between it and where it was sent", async () => {
      const mapRenderer = await renderWorld();
      // A house square across the straight way east, about 28 m wide.
      const house = {
        west: 0.0003,
        east: 0.0007,
        south: -0.00013,
        north: 0.00013,
      };
      const obstaclesWithin = vi.fn(() => [
        {
          kind: "building" as const,
          polygons: [
            footprint(house.west, house.south, house.east, house.north),
          ],
        },
      ]);
      Object.assign(mapRenderer, { obstaclesWithin });

      tap(mapRenderer);
      expect(obstaclesWithin).toHaveBeenCalled();
      expect(avaiaLines("en", voice, "walk")).toContain(
        lastLabel(mapRenderer)?.speech,
      );

      // Every step of the way stays outside the house.
      for (let step = 0; step < 300; step++) {
        act(() => vi.advanceTimersByTime(200));
        const [longitude, latitude] = lastAvaia(mapRenderer)!.lngLat;
        const inside =
          longitude > here.longitude + house.west &&
          longitude < here.longitude + house.east &&
          latitude > here.latitude + house.south &&
          latitude < here.latitude + house.north;
        expect(inside).toBe(false);
      }
      const arrived = lastAvaia(mapRenderer);
      expect(arrived?.lngLat[0]).toBeCloseTo(there.longitude, 6);
      expect(arrived?.lngLat[1]).toBeCloseTo(there.latitude, 6);
    });

    it("says what walls a place in, and stays, when there is no way round", async () => {
      const mapRenderer = await renderWorld();
      // A ring of water around where it was sent.
      const moat = [
        ...footprint(0.0006, -0.0004, 0.0014, 0.0004),
        ...footprint(0.0008, -0.0002, 0.0012, 0.0002),
      ];
      Object.assign(mapRenderer, {
        obstaclesWithin: () => [{ kind: "water", polygons: [moat] }],
      });

      tap(mapRenderer);
      act(() => vi.advanceTimersByTime(5_000));

      expect(avaiaLines("en", voice, "blocked.water")).toContain(
        lastLabel(mapRenderer)?.speech,
      );
      expect(lastAvaia(mapRenderer)?.lngLat).toEqual([
        here.longitude,
        here.latitude,
      ]);
    });

    it("goes to see what its owner walked past, and writes it down", async () => {
      vi.useFakeTimers();
      const mapRenderer = createMapRendererDouble({ kind: "ready" });
      const monument = {
        id: "poi:42",
        longitude: here.longitude + 0.0003,
        latitude: here.latitude,
        kind: "monument",
        name: "Volodymyr the Great",
        facts: { historic: "memorial" },
      };
      mapRenderer.setLandmarks([monument]);
      renderView({
        mapRenderer,
        geolocation: createGeolocationDouble({ position: here }),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
        findItems: curiousCore(),
      });
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Map centred on this device" }),
        ).toBeVisible(),
      );

      // The drive asks what is around; it sets off with a word about it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(lastLabel(mapRenderer)?.speech).toContain("Volodymyr the Great");
      expect(lastAvaia(mapRenderer)).toMatchObject({ clipId: "walk" });

      // It arrives, looks the monument over, and says what it learned. Time
      // moves in steps so each thing it does gets to start before the next.
      for (let step = 0; step < 6; step += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });
      }
      const studied = avaiaLines("en", voice, "landmark.studied").map((line) =>
        line.replace("{landmark}", "“Volodymyr the Great”"),
      );
      const said = vi
        .mocked(mapRenderer.setObservedPositionLabel)
        .mock.calls.map(([label]) => label?.speech);
      expect(said.some((line) => studied.includes(line ?? ""))).toBe(true);

      // What it learned is its own note, on this device.
      vi.useRealTimers();
      fireEvent.click(screen.getByRole("button", { name: "Edit x0skai" }));
      const notes = screen.getByRole("region", { name: "Landmarks studied" });
      expect(notes).toHaveTextContent("“Volodymyr the Great”");
      expect(notes).toHaveTextContent("historic: memorial");
    });

    it("notices a landmark whose tiles land after the position does", async () => {
      vi.useFakeTimers();
      const mapRenderer = createMapRendererDouble({ kind: "ready" });
      renderView({
        mapRenderer,
        geolocation: createGeolocationDouble({ position: here }),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
        findItems: curiousCore(),
      });
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Map centred on this device" }),
        ).toBeVisible(),
      );
      // The position is known, but the tile carrying the monument is not yet.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(lastLabel(mapRenderer)?.speech).toBeUndefined();

      // The person has not moved; the map finishes loading around them.
      act(() =>
        mapRenderer.setLandmarks([
          {
            id: "poi:7",
            longitude: here.longitude + 0.0003,
            latitude: here.latitude,
            kind: "memorial",
            name: "Late tile",
            facts: {},
          },
        ]),
      );
      for (let step = 0; step < 4; step += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });
      }

      expect(
        vi
          .mocked(mapRenderer.setObservedPositionLabel)
          .mock.calls.some(([label]) => label?.speech?.includes("Late tile")),
      ).toBe(true);
    });

    it("stands the Bond at a declared point and names it for what it is", async () => {
      vi.useFakeTimers();
      const mapRenderer = createMapRendererDouble({ kind: "ready" });
      const declared = { longitude: 30.563, latitude: 50.4265 };
      renderView({
        mapRenderer,
        geolocation: createDeclaredGeolocation(declared),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      });
      await vi.waitFor(() =>
        expect(lastAvaia(mapRenderer)?.lngLat).toEqual([
          declared.longitude,
          declared.latitude,
        ]),
      );

      expect(lastLabel(mapRenderer)?.detail).toBe("Manual position");
    });

    it("asks before revealing fog, then sends the Avaia to reveal it", async () => {
      vi.useFakeTimers();
      const fog = createFogFieldDouble();
      const setFogMarks = vi.fn();
      const mapRenderer = Object.assign(
        createMapRendererDouble({ kind: "ready" }),
        { fog, setFogMarks },
      );
      avaiaStandsAt(here);
      renderView({
        mapRenderer,
        findItems: nearbyProximityCore(),
        geolocation: createGeolocationDouble({ position: here }),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      });
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Map centred on this device" }),
        ).toBeVisible(),
      );
      await vi.waitFor(() => expect(screen.getByText("0m")).toBeVisible());
      // Standing in a cell is enough to lift it: the person is there.
      expect(fog.isRevealed(fog.cellAt(here).id)).toBe(true);
      const next = fog.cellAt(there).id;
      expect(
        setFogMarks.mock.lastCall?.[0].some(
          (mark: { cell: { id: string } }) => mark.cell.id === next,
        ),
      ).toBe(true);

      act(() => mapRenderer.tapGround({ ...there, ground: "fog" }));
      const prompt = screen.getByRole("dialog", {
        name: "Reveal this patch of fog?",
      });
      expect(prompt).toHaveTextContent("x0skai will go there");
      fireEvent.click(within(prompt).getByRole("button", { name: "Reveal" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(avaiaLines("en", voice, "fog.reveal")).toContain(
        lastLabel(mapRenderer)?.speech,
      );
      act(() => vi.advanceTimersByTime(200));
      expect(lastAvaia(mapRenderer)).toMatchObject({ clipId: "walk" });
      expect(screen.getByRole("status")).toHaveTextContent("Revealing 1 of 3");

      act(() => vi.advanceTimersByTime(60_000));
      expect(fog.isRevealed(next)).toBe(true);
      expect(
        vi
          .mocked(mapRenderer.setObservedPositionLabel)
          .mock.calls.some(([label]) =>
            avaiaLines("en", voice, "fog.revealed").includes(
              label?.speech ?? "",
            ),
          ),
      ).toBe(true);
    });

    it("closes the fog prompt when a person moves the camera themselves", async () => {
      vi.useFakeTimers();
      const fog = createFogFieldDouble();
      const mapRenderer = Object.assign(
        createMapRendererDouble({ kind: "ready" }),
        { fog, setFogMarks: vi.fn() },
      );
      avaiaStandsAt(here);
      renderView({
        mapRenderer,
        findItems: nearbyProximityCore(),
        geolocation: createGeolocationDouble({ position: here }),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      });
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Map centred on this device" }),
        ).toBeVisible(),
      );
      await vi.waitFor(() => expect(screen.getByText("0m")).toBeVisible());

      act(() => mapRenderer.tapGround({ ...there, ground: "fog" }));
      expect(
        screen.getByRole("dialog", { name: "Reveal this patch of fog?" }),
      ).toBeVisible();

      // A move the application itself made is not a person looking away.
      act(() => mapRenderer.moveCamera(mapRenderer.getCamera(), false));
      expect(screen.queryByRole("dialog")).not.toBeNull();

      act(() => mapRenderer.moveCamera(mapRenderer.getCamera(), true));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("closes the fog prompt when the Dock opens a detail screen", async () => {
      vi.useFakeTimers();
      const fog = createFogFieldDouble();
      const mapRenderer = Object.assign(
        createMapRendererDouble({ kind: "ready" }),
        { fog, setFogMarks: vi.fn() },
      );
      avaiaStandsAt(here);
      renderView({
        mapRenderer,
        findItems: nearbyProximityCore(),
        geolocation: createGeolocationDouble({ position: here }),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      });
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Map centred on this device" }),
        ).toBeVisible(),
      );
      await vi.waitFor(() => expect(screen.getByText("0m")).toBeVisible());

      act(() => mapRenderer.tapGround({ ...there, ground: "fog" }));
      expect(
        screen.getByRole("dialog", { name: "Reveal this patch of fog?" }),
      ).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "Edit x0skai" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("says why not when fog is out of reach", async () => {
      vi.useFakeTimers();
      const fog = createFogFieldDouble();
      const mapRenderer = Object.assign(
        createMapRendererDouble({ kind: "ready" }),
        { fog, setFogMarks: vi.fn() },
      );
      avaiaStandsAt(here);
      renderView({
        mapRenderer,
        findItems: nearbyProximityCore(),
        geolocation: createGeolocationDouble({ position: here }),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      });
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Map centred on this device" }),
        ).toBeVisible(),
      );
      await vi.waitFor(() => expect(screen.getByText("0m")).toBeVisible());

      act(() =>
        mapRenderer.tapGround({
          longitude: here.longitude + 0.05,
          latitude: here.latitude,
          ground: "fog",
        }),
      );

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(avaiaLines("en", voice, "blocked.fog")).toContain(
        lastLabel(mapRenderer)?.speech,
      );
    });

    it("holds fog work, and says so, while Avaia has no place of her own", async () => {
      vi.useFakeTimers();
      const fog = createFogFieldDouble();
      const mapRenderer = Object.assign(
        createMapRendererDouble({ kind: "ready" }),
        { fog, setFogMarks: vi.fn() },
      );
      renderView({
        mapRenderer,
        findItems: nearbyProximityCore(),
        geolocation: createGeolocationDouble({ position: here }),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      });
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Map centred on this device" }),
        ).toBeVisible(),
      );
      // Not at 0m: nobody has said where she is, so the face says so.
      expect(screen.getByText("?")).toBeVisible();
      expect(screen.queryByText("0m")).toBeNull();
      expect(
        screen.getByText(/Where Avaia is isn't known yet, so fog work waits\./),
      ).toBeInTheDocument();
      act(() =>
        mapRenderer.tapGround({
          longitude: there.longitude,
          latitude: there.latitude,
          ground: "fog",
        }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("holds fog work, and says so, once Avaia is beyond the red line", async () => {
      vi.useFakeTimers();
      const fog = createFogFieldDouble();
      const mapRenderer = Object.assign(
        createMapRendererDouble({ kind: "ready" }),
        { fog, setFogMarks: vi.fn() },
      );
      avaiaStandsAt({ ...here, longitude: here.longitude + 0.09 });
      renderView({
        mapRenderer,
        findItems: nearbyProximityCore(),
        geolocation: createGeolocationDouble({ position: here }),
        avatarChoice: createAvatarChoiceViewState("dasha-study", undefined),
      });
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Recenter on this device" }),
        ).toBeVisible(),
      );
      await vi.waitFor(() => expect(screen.getByText(/km$/)).toBeVisible());
      expect(screen.getByText(/too far to reveal fog/)).toBeInTheDocument();
      act(() =>
        mapRenderer.tapGround({
          longitude: there.longitude,
          latitude: there.latitude,
          ground: "fog",
        }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("does not walk while its Bond is at the wheel", async () => {
      const mapRenderer = await renderWorld();
      fireEvent.click(
        screen.getByRole("button", { name: "Take the wheel as 0x0sky" }),
      );
      act(() => vi.advanceTimersByTime(5_000));
      vi.mocked(mapRenderer.setObservedPositionLabel).mockClear();

      act(() =>
        (
          mapRenderer as ReturnType<typeof renderer> & {
            tapGround: (tap: object) => void;
          }
        ).tapGround({ ...there, ground: "open" }),
      );
      act(() => vi.advanceTimersByTime(1_000));

      expect(lastLabel(mapRenderer)?.speech).toBeUndefined();
    });
  });

  it("keeps the world usable when the host has no location capability", async () => {
    const mapRenderer = renderer();

    renderView({ mapRenderer });

    const control = await screen.findByRole("button", {
      name: "Location unavailable on this host",
    });
    expect(control).toBeDisabled();
    expect(mapRenderer.setCamera).not.toHaveBeenCalled();
    expect(mapRenderer.setObservedPosition).toHaveBeenCalledWith(null);
    // A host without the capability is not a renderer failure.
    expect(screen.queryByText("Map unavailable")).toBeNull();
  });
});

describe("world readiness frame", () => {
  function localModel(
    host: Pick<LocalModelHost, "inspect" | "isCached">,
  ): LocalModelDependency {
    return {
      defaultModelId: "small",
      catalog: [
        {
          modelId: "small",
          family: "qwen",
          label: "Small",
          vramMb: 512,
          licence: "Apache-2.0",
          licenceName: "Apache 2.0",
          attribution: null,
          usePolicy: null,
          notices: [],
          faithfulness: null,
        },
      ],
      host: {
        ...host,
        describe: () => Promise.resolve({ bytes: null, source: "mirror" }),
        open: () => Promise.reject(new Error("never opened")),
        remove: () => Promise.resolve(),
      },
    };
  }

  function frame(container: HTMLElement): Element | null {
    return container.querySelector(".authenticated-map-home");
  }

  afterEach(cleanup);

  it("turns orange and says so when WebGPU cannot run the model", async () => {
    const { container } = renderView({
      localModel: localModel({
        inspect: () => Promise.resolve({ kind: "webgpu_missing" }),
        isCached: () => Promise.resolve(false),
      }),
    });

    expect(
      await screen.findByText("On-device model unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Unavailable: this browser has no WebGPU."),
    ).toBeInTheDocument();
    expect(frame(container)).toHaveAttribute("data-readiness", "degraded");
  });

  it("turns green once the model WebLLM needs is on this device", async () => {
    const { container } = renderView({
      localModel: localModel({
        inspect: () => Promise.resolve({ kind: "usable" }),
        isCached: () => Promise.resolve(true),
      }),
    });

    await vi.waitFor(() =>
      expect(frame(container)).toHaveAttribute("data-readiness", "connected"),
    );
  });

  it("fades a good answer after five seconds, and keeps a problem framed", async () => {
    vi.useFakeTimers();
    try {
      const good = renderView({
        localModel: localModel({
          inspect: () => Promise.resolve({ kind: "usable" }),
          isCached: () => Promise.resolve(true),
        }),
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(frame(good.container)).toHaveAttribute(
        "data-readiness",
        "connected",
      );
      expect(frame(good.container)).toHaveAttribute(
        "data-readiness-shown",
        "true",
      );
      act(() => {
        vi.advanceTimersByTime(READINESS_FRAME_SETTLE_MS);
      });
      expect(frame(good.container)).toHaveAttribute(
        "data-readiness-shown",
        "false",
      );
      good.unmount();

      const bad = renderView({
        mapRenderer: renderer({
          kind: "unavailable",
          reason: "styleLoadFailed",
        }),
      });
      act(() => {
        vi.advanceTimersByTime(READINESS_FRAME_SETTLE_MS * 2);
      });
      expect(frame(bad.container)).toHaveAttribute(
        "data-readiness-shown",
        "true",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("traces the frame along the screen edge, above every layer", () => {
    const { container } = renderView();

    expect(
      container.querySelector(
        ".app-shell__frame > .authenticated-map-home__readiness",
      ),
    ).not.toBeNull();
  });

  it("turns red when the map did not load", () => {
    const { container } = renderView({
      mapRenderer: renderer({
        kind: "unavailable",
        reason: "styleLoadFailed",
      }),
    });

    expect(frame(container)).toHaveAttribute("data-readiness", "failed");
  });

  it("turns orange and says so when location permission is refused", async () => {
    const { container } = renderView({
      geolocation: createGeolocationDouble({ permission: "denied" }),
    });

    await vi.waitFor(() =>
      expect(frame(container)).toHaveAttribute("data-readiness", "degraded"),
    );
    expect(
      within(screen.getByRole("region", { name: "World status" })).getByText(
        "Location permission denied",
      ),
    ).toBeInTheDocument();
  });
});
