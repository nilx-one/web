// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The Dock presents two identities and which of them is at the wheel.
 *
 * The identity at the wheel sits on the left: activating it brings the world to
 * it. The other sits on the right: activating it hands the wheel over, when
 * that is possible at all. Nothing here writes shared-world state — the wheel
 * is presentation, and spectating is what an identity does when it is not
 * driving.
 */

/** What this device can do about the Avaia runtime right now. */
export type AvaiaAvailability =
  "ready" | "preparing" | "downloadable" | "unavailable";

export type DockSeat = "bond" | "avaia";

/** What activating the identity on the right would do. */
export type DockHandover = "switch" | "download" | undefined;

export interface DockIdentityViewState {
  readonly seat: DockSeat;
  readonly address: string;
  readonly glyph: string;
  /** The relationship this identity has to the world right now. */
  readonly role: string;
  /** Presentation tone for the status dot. */
  readonly tone: "authenticated" | "ready" | "working" | "idle";
  readonly actionable: boolean;
  readonly actionLabel: string;
}

export interface BondDockViewState {
  readonly wheel: DockSeat;
  /** At the wheel. Activating it focuses the world on this identity. */
  readonly left: DockIdentityViewState;
  /** Spectating. Activating it takes the wheel, or prepares the runtime. */
  readonly right: DockIdentityViewState;
  readonly handover: DockHandover;
}

export interface BondDockInput {
  readonly pubDress: string;
  readonly avaiaPubDress?: string | undefined;
  readonly wheel: DockSeat;
  readonly avaia: AvaiaAvailability;
  /** Whether the world has somewhere to move the camera to. */
  readonly focusable: boolean;
  /** Whether this composition can start a runtime download at all. */
  readonly downloadable: boolean;
}

function avaiaRole(availability: AvaiaAvailability): string {
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
  }
}

export function createBondDockViewState(
  input: BondDockInput,
): BondDockViewState {
  const avaiaAddress = input.avaiaPubDress ?? "Avaia";
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
    // A Bond that is not driving is watching: that is what spectating means.
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
    role: seated === "left" ? "driving" : avaiaRole(input.avaia),
    // Driving is about the wheel; the status dot is about the runtime. An
    // Avaia can be the identity the world is showing while its runtime is not
    // up, and the dot must not claim otherwise.
    tone: avaiaTone(input.avaia),
    actionable: seated === "left" ? input.focusable : handover !== undefined,
    actionLabel:
      seated === "left"
        ? `Focus the world on ${avaiaAddress}`
        : handover === "switch"
          ? `Hand the wheel to ${avaiaAddress}`
          : handover === "download"
            ? `Download the ${avaiaAddress} runtime`
            : `${avaiaAddress} is unavailable on this device`,
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
