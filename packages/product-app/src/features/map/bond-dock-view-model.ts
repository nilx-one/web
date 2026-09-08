// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvaiaConfigurationState } from "@nilx-one/application";

/**
 * The Dock presents two identities and which of them is at the wheel.
 *
 * The identity at the wheel sits on the left: activating a Bond brings the
 * world to it. Avaia activation opens its owner-controlled profile surface;
 * runtime handover remains a separate presentation capability. Nothing here
 * writes shared-world state.
 */

/** What this device can do about the Avaia runtime right now. */
export type AvaiaAvailability =
  | "ready"
  | "preparing"
  | "downloadable"
  | "unavailable";

export type DockSeat = "bond" | "avaia";

/** What the runtime can do when the spectator takes the wheel. */
export type DockHandover = "switch" | "download" | undefined;

export interface DockIdentityViewState {
  readonly seat: DockSeat;
  readonly address: string;
  readonly glyph: string;
  /** The identity/profile/runtime state presented beside this address. */
  readonly role: string;
  /** Presentation tone for the status dot. */
  readonly tone: "authenticated" | "ready" | "working" | "idle";
  readonly actionable: boolean;
  readonly actionLabel: string;
}

export interface BondDockViewState {
  readonly wheel: DockSeat;
  /** At the wheel. */
  readonly left: DockIdentityViewState;
  /** Spectating. */
  readonly right: DockIdentityViewState;
  readonly handover: DockHandover;
}

export interface BondDockInput {
  readonly pubDress: string;
  readonly avaiaPubDress?: string | undefined;
  readonly wheel: DockSeat;
  readonly avaia: AvaiaAvailability;
  /** Persisted identity/profile state; never inferred from runtime. */
  readonly avaiaConfiguration?: AvaiaConfigurationState | undefined;
  /** Whether the world has somewhere to move the camera to. */
  readonly focusable: boolean;
  /** Whether this composition can start a runtime download at all. */
  readonly downloadable: boolean;
}

function avaiaRole(
  configuration: AvaiaConfigurationState | undefined,
  availability: AvaiaAvailability,
): string {
  if (configuration === "unconfigured") return "unconfigured";
  switch (availability) {
    case "ready":
      return "ready";
    case "preparing":
      return "preparing";
    case "downloadable":
      return "download";
    case "unavailable":
      return "unavailable";
  }
}

function avaiaTone(
  configuration: AvaiaConfigurationState | undefined,
  availability: AvaiaAvailability,
): DockIdentityViewState["tone"] {
  if (configuration === "unconfigured") return "idle";
  switch (availability) {
    case "ready":
      return "ready";
    case "preparing":
      return "working";
    case "downloadable":
    case "unavailable":
      return "idle";
  }
}

export function createBondDockViewState(
  input: BondDockInput,
): BondDockViewState {
  const avaiaAddress = input.avaiaPubDress ?? "Avaia";
  const hasAvaiaAddress = input.avaiaPubDress !== undefined;
  const driving = input.wheel;
  const handover: DockHandover =
    driving === "avaia"
      ? "switch"
      : input.avaia === "ready"
        ? "switch"
        : input.avaia === "downloadable" && input.downloadable
          ? "download"
          : undefined;

  const bond = (seated: "left" | "right"): DockIdentityViewState => ({
    seat: "bond",
    address: input.pubDress,
    glyph: "0x0",
    role: seated === "left" ? "You" : "spectate",
    tone: "authenticated",
    actionable: seated === "left" ? input.focusable : true,
    actionLabel:
      seated === "left"
        ? `Focus the world on ${input.pubDress}`
        : `Take the wheel as ${input.pubDress}`,
  });

  const avaia = (seated: "left" | "right"): DockIdentityViewState => ({
    seat: "avaia",
    address: avaiaAddress,
    glyph: "AI",
    role:
      seated === "left"
        ? "driving"
        : avaiaRole(input.avaiaConfiguration, input.avaia),
    tone:
      seated === "left"
        ? "ready"
        : avaiaTone(input.avaiaConfiguration, input.avaia),
    // Runtime unavailability must never block identity/profile editing.
    actionable: hasAvaiaAddress,
    actionLabel:
      input.avaiaConfiguration === "unconfigured"
        ? `Set up ${avaiaAddress}`
        : `Edit ${avaiaAddress}`,
  });

  return {
    wheel: driving,
    left: driving === "bond" ? bond("left") : avaia("left"),
    right: driving === "bond" ? avaia("right") : bond("right"),
    handover,
  };
}

export interface AvaiaRuntimeEnvironment {
  /** Whether this device exposes the GPU the runtime needs. */
  readonly acceleratedGraphics: boolean;
  /** The published runtime this client would download, when one exists. */
  readonly artifact?: string | undefined;
  /** Whether that runtime is already loaded and answering. */
  readonly loaded?: boolean;
  /** Whether it is being fetched or warmed up right now. */
  readonly preparing?: boolean;
}

/**
 * There is no published Avaia runtime yet, so every host answers "unavailable"
 * — which is the truth: there is nothing to download. The other states exist so
 * the Dock already knows how to say what it will be able to say.
 */
export function avaiaAvailability(
  environment: AvaiaRuntimeEnvironment,
): AvaiaAvailability {
  if (environment.artifact === undefined || !environment.acceleratedGraphics) {
    return "unavailable";
  }
  if (environment.loaded === true) return "ready";
  if (environment.preparing === true) return "preparing";
  return "downloadable";
}
