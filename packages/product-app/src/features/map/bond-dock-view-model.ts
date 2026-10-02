// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvaiaConfigurationState } from "@nilx-one/application";

/**
 * The Dock presents two identities and which of them is at the wheel.
 *
 * `left` is the identity at the wheel: activating it brings the world to it.
 * `right` is the other: activating it hands the wheel over, when that is
 * possible at all. Those are roles, not places — on screen the Avaia always
 * sits first and the Bond second, so a handover changes who drives, never
 * where anyone sits. Nothing here writes shared-world state — the wheel
 * is presentation, and spectating is what an identity does when it is not
 * driving.
 */

/** What this device can do about the Avaia runtime right now. */
export type AvaiaAvailability =
  "ready" | "preparing" | "downloadable" | "unavailable" | "error";

export type DockSeat = "bond" | "avaia";

/**
 * What the Dock's own action would open: the identity currently at the wheel,
 * on the surface where it is configured.
 */
export interface DockConfigureAction {
  readonly seat: DockSeat;
  readonly label: string;
}

export interface DockIdentityViewState {
  readonly seat: DockSeat;
  readonly address: string;
  readonly glyph: string;
  /** The relationship this identity has to the world right now. */
  readonly role: string;
  /**
   * Presentation tone for the status dot. It follows the role: driving is the
   * one live tone, and what is only watching or cannot run stays quiet.
   */
  readonly tone: "driving" | "ready" | "working" | "idle" | "error";
  readonly actionable: boolean;
  readonly actionLabel: string;
  /**
   * What activating the card does. An Avaia its owner has not configured has
   * nothing to hand the wheel to yet, so its card opens its setup instead.
   */
  readonly intent: "focus" | "wheel" | "configure";
}

/** One place on the Dock, and whether its identity is the one driving. */
export interface DockPlace {
  readonly driving: boolean;
  readonly identity: DockIdentityViewState;
}

export interface BondDockViewState {
  readonly wheel: DockSeat;
  /** At the wheel. Activating it focuses the world on this identity. */
  readonly left: DockIdentityViewState;
  /** Spectating. Activating it takes the wheel, or prepares the runtime. */
  readonly right: DockIdentityViewState;
  /**
   * Whether taking the wheel would also ask this device for the Avaia runtime.
   * It is one gesture: a person takes the wheel, and what a device can fetch to
   * serve that is the device's business, not a second decision.
   */
  readonly preparesRuntime: boolean;
  /** What the Dock's action configures, which is whoever is driving. */
  readonly configure: DockConfigureAction;
  /** Screen order, fixed whoever drives: the Avaia first, the Bond second. */
  readonly places: readonly [DockPlace, DockPlace];
}

export interface BondDockInput {
  readonly pubDress: string;
  readonly avaiaPubDress?: string | undefined;
  readonly wheel: DockSeat;
  readonly avaia: AvaiaAvailability;
  /**
   * What the owner stored, which is not what this device can run. Absent means
   * no profile has been read, and the Dock says nothing about configuration.
   */
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
  // What an owner has not configured is the first thing to say about it, and
  // it stays true whatever a device can or cannot run.
  if (configuration === "unconfigured") return "unconfigured";
  switch (availability) {
    case "ready":
      return "ready";
    case "preparing":
      return "preparing";
    case "downloadable":
      return "download";
    // A device that runs no model leaves the Avaia resting, not out of reach:
    // the wheel can still be handed to it. "unavailable" is kept for a card
    // that truly cannot be chosen.
    case "unavailable":
      return "inactive";
    case "error":
      return "error";
  }
}

function avaiaTone(
  availability: AvaiaAvailability,
): DockIdentityViewState["tone"] {
  switch (availability) {
    case "ready":
      return "ready";
    case "preparing":
      return "working";
    case "downloadable":
    case "unavailable":
      return "idle";
    case "error":
      return "error";
  }
}

/**
 * Who the world opens with at the wheel. An Avaia nobody has configured yet
 * is not someone a Bond can watch, so a fresh Bond opens driving itself; any
 * other world opens on the Avaia.
 */
export function openingWheel(
  configuration: AvaiaConfigurationState | undefined,
): DockSeat {
  return configuration === "unconfigured" ? "bond" : "avaia";
}

/**
 * An identity that is not driving and cannot be chosen is what "unavailable"
 * means on the Dock; a broken runtime still says "error" first.
 */
function unavailableUnlessChoosable(
  identity: DockIdentityViewState,
): DockIdentityViewState {
  if (identity.actionable || identity.tone === "error") return identity;
  return { ...identity, role: "unavailable", tone: "idle" };
}

export function createBondDockViewState(
  input: BondDockInput,
): BondDockViewState {
  const avaiaAddress = input.avaiaPubDress ?? "Avaia";
  const driving = input.wheel;
  // Taking the wheel is presentation: it changes which body the world draws.
  // A device that cannot run a model is still a device its owner watches the
  // world from, so the runtime is stated on the card and gates nothing.
  const preparesRuntime =
    driving === "bond" &&
    input.avaia === "downloadable" &&
    input.downloadable &&
    input.avaiaConfiguration !== "unconfigured";
  // Configuration state can change the wording, but never which identity the
  // action targets: the left seat is the source of truth for the Dock action.
  const configure: DockConfigureAction =
    driving === "avaia"
      ? {
          seat: "avaia",
          label:
            input.avaiaConfiguration === "unconfigured"
              ? `Set up ${avaiaAddress}`
              : `Edit ${avaiaAddress}`,
        }
      : { seat: "bond", label: `Edit ${input.pubDress}` };

  const bond = (seated: "left" | "right"): DockIdentityViewState => ({
    seat: "bond",
    address: input.pubDress,
    glyph: "0x0",
    // A Bond that is not driving is watching: that is what spectating means.
    // "You" is already the line's subject, so the role never repeats it.
    role: seated === "left" ? "driving" : "spectate",
    tone: seated === "left" ? "driving" : "idle",
    actionable: seated === "left" ? input.focusable : true,
    actionLabel:
      seated === "left"
        ? `Focus the world on ${input.pubDress}`
        : `Take the wheel as ${input.pubDress}`,
    intent: seated === "left" ? "focus" : "wheel",
  });

  const avaia = (seated: "left" | "right"): DockIdentityViewState => {
    const unconfigured = input.avaiaConfiguration === "unconfigured";
    const setUp = seated === "right" && unconfigured;
    const drives = seated === "left" && !unconfigured;
    return {
      seat: "avaia",
      address: avaiaAddress,
      glyph: "AI",
      role: drives
        ? "driving"
        : avaiaRole(input.avaiaConfiguration, input.avaia),
      // The dot reads with the word beside it: driving is live, and an Avaia
      // nobody has configured is quiet whatever this device could run.
      tone: drives ? "driving" : unconfigured ? "idle" : avaiaTone(input.avaia),
      actionable: seated === "left" ? input.focusable : true,
      actionLabel:
        seated === "left"
          ? `Focus the world on ${avaiaAddress}`
          : setUp
            ? `Set up ${avaiaAddress}`
            : `Hand the wheel to ${avaiaAddress}`,
      intent: seated === "left" ? "focus" : setUp ? "configure" : "wheel",
    };
  };

  const left = driving === "bond" ? bond("left") : avaia("left");
  const right = unavailableUnlessChoosable(
    driving === "bond" ? avaia("right") : bond("right"),
  );
  const place = (seat: DockSeat): DockPlace =>
    left.seat === seat
      ? { driving: true, identity: left }
      : { driving: false, identity: right };

  return {
    wheel: driving,
    left,
    right,
    preparesRuntime,
    configure,
    places: [place("avaia"), place("bond")],
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
  /** Whether loading or running it failed, e.g. a WebLLM engine error. */
  readonly failed?: boolean;
}

/**
 * There is no published Avaia runtime yet, so every host answers "unavailable"
 * — which is the truth: there is nothing to download. The other states exist so
 * the Dock already knows how to say what it will be able to say.
 */
export function avaiaAvailability(
  environment: AvaiaRuntimeEnvironment,
): AvaiaAvailability {
  if (environment.failed === true) return "error";
  if (environment.artifact === undefined || !environment.acceleratedGraphics) {
    return "unavailable";
  }
  if (environment.loaded === true) return "ready";
  if (environment.preparing === true) return "preparing";
  return "downloadable";
}
