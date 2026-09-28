// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Where each piece of persisted state is allowed to live.
 *
 * Three placements, and every stored record belongs to exactly one:
 *
 * - `server` — the identity service holds it: the `pub_dress`, everything a
 *   sign-in needs (provider bindings, credentials, sessions), and the 3D-model
 *   identifier of a body. Nothing else is server state.
 * - `device` — never leaves this device. What a device could run and how it
 *   is set up: the chosen on-device model and its download, the journal key,
 *   work this device has in flight. Carrying it to another device would mean
 *   nothing there, so it is not carried.
 * - `synchronizable` — local-first, and eligible to travel between a Bond's
 *   own devices: interface preferences a person expects to follow them, and
 *   what a Bond earned or remembered by playing. "Eligible" is the whole
 *   claim: today none of it leaves the device, and when it does it travels
 *   under the `.bnd` discipline — end-to-end, device to device, the service
 *   at most a blind relay — and never becomes identity, Core, or protocol
 *   state.
 *
 * The architecture test reads this table against the source tree, so a key
 * that is not here is a failing build, not an unclassified record.
 */
export type StatePlacement = "server" | "device" | "synchronizable";

/** Where a record is kept today, as opposed to where the contract places it. */
export type StateMedium =
  | "identity-service"
  | "local-storage"
  | "indexed-db"
  | "model-cache"
  | "bnd-file";

export interface PlacedState {
  /** A stable name for the record, for prose and for the test's messages. */
  readonly id: string;
  readonly placement: StatePlacement;
  readonly medium: StateMedium;
  /**
   * The storage key or key prefix in the browser, the table (and column) in
   * the service. Per-owner keys are listed without their owner suffix.
   */
  readonly key: string;
  /** The key is suffixed with the owning Bond's `pub_dress`. */
  readonly perOwner: boolean;
  readonly what: string;
  /**
   * Fields of an otherwise synchronizable record that are this device's alone
   * and are left behind when the record travels.
   */
  readonly deviceOnlyFields?: readonly string[];
}

export const STATE_PLACEMENT: readonly PlacedState[] = [
  // ─── server ────────────────────────────────────────────────────────────
  {
    id: "identity.pubDress",
    placement: "server",
    medium: "identity-service",
    key: "identities.pub_dress",
    perOwner: false,
    what: "The Bond's address, its owned Avaia's address, and the public label folded from it.",
  },
  {
    id: "identity.authorization",
    placement: "server",
    medium: "identity-service",
    key: "identity_providers, native_credentials, native_sessions",
    perOwner: false,
    what: "Everything a sign-in needs: provider bindings, Argon2id verifiers, recovery keys, sessions and the remembered-Bond hint.",
  },
  {
    id: "identity.avatarModel",
    placement: "server",
    medium: "identity-service",
    key: "identities.avatar_model",
    perOwner: false,
    what: "The 3D-model identifier of a body: a named study today, a customization digest once bodies can be customized.",
  },
  {
    id: "avatar.wardrobe",
    placement: "server",
    medium: "local-storage",
    key: "nilx-one.avatar.wardrobe",
    perOwner: false,
    what: "What a body wears and which body an Avaia chose. Server-placed: the customization becomes the digest identities.avatar_model will carry. Kept on the device until the contract has that field.",
  },

  // ─── device ────────────────────────────────────────────────────────────
  {
    id: "localModel.choice",
    placement: "device",
    medium: "local-storage",
    key: "nilx-one.localModel.choice",
    perOwner: false,
    what: "Which on-device model this device runs. Another device has its own memory, GPU and eligibility, so the choice means nothing there.",
  },
  {
    id: "localModel.download",
    placement: "device",
    medium: "model-cache",
    key: "@mlc-ai/web-llm cache",
    perOwner: false,
    what: "The downloaded model weights. Gigabytes this device fetched for itself.",
  },
  {
    id: "presence.journalKey",
    placement: "device",
    medium: "indexed-db",
    key: "nilx-presence/keys",
    perOwner: false,
    what: "The non-extractable key the presence journal is sealed with. Never transmitted, never derived from identity.",
  },
  {
    id: "fog.jobs",
    placement: "device",
    medium: "local-storage",
    key: "nilx-one.fog.jobs.v1",
    perOwner: true,
    what: "Reveals this device's Avaia has in flight. The revealed cell is what travels; the timer that opens it is this device's work.",
  },

  // ─── synchronizable: interface preferences ─────────────────────────────
  {
    id: "interface.locale",
    placement: "synchronizable",
    medium: "local-storage",
    key: "nilx-one.interface.locale",
    perOwner: false,
    what: "The language a person chose, or auto.",
  },
  {
    id: "interface.appearance",
    placement: "synchronizable",
    medium: "local-storage",
    key: "nilx-one.interface.appearance",
    perOwner: false,
    what: "Light, dark, or follow the device.",
  },
  {
    id: "interface.dimension",
    placement: "synchronizable",
    medium: "local-storage",
    key: "nilx-one.interface.dimension",
    perOwner: false,
    what: "Whether the map is presented flat (2D) or volumetric (3D).",
  },

  // ─── synchronizable: what a Bond earned and remembered ─────────────────
  {
    id: "progression",
    placement: "synchronizable",
    medium: "local-storage",
    key: "nilx-one.progression.v2",
    perOwner: true,
    what: "Bond and Avaia experience, and with it their levels.",
    deviceOnlyFields: ["deviceAchievements", "settingsHintSeen"],
  },
  {
    id: "progression.legacy",
    placement: "synchronizable",
    medium: "local-storage",
    key: "nilx-one.progression.v1",
    perOwner: true,
    what: "Version 1 of the same record, read once and carried into version 2.",
  },
  {
    id: "fog.reveals",
    placement: "synchronizable",
    medium: "local-storage",
    key: "nilx-one.fog.reveals.v1",
    perOwner: true,
    what: "The cells a Bond or its Avaia opened.",
  },
  {
    id: "avaia.landmarks",
    placement: "synchronizable",
    medium: "local-storage",
    key: "nilx-one.avaia.landmarks.v1",
    perOwner: true,
    what: "Landmarks noticed in passing and studied by the Avaia.",
  },
  {
    id: "world.memory",
    placement: "synchronizable",
    medium: "local-storage",
    key: "nilx-one.world-memory.v1",
    perOwner: true,
    what: "Where the Bond and its Avaia were last seen: the position the world reopens on.",
  },
  {
    id: "bond.locationOverrides",
    placement: "synchronizable",
    medium: "local-storage",
    key: "nilx-one.bond-location-overrides.v1",
    perOwner: true,
    what: "Artificial presentation positions an owner declared for counterpart Bonds.",
  },
  {
    id: "presence.journal",
    placement: "synchronizable",
    medium: "indexed-db",
    key: "nilx-presence/visits",
    perOwner: false,
    what: "The sealed visit history (bond.journal). Travels only under the .bnd discipline, sealed, and never through the service in the clear.",
  },
  {
    id: "bond.chain",
    placement: "synchronizable",
    medium: "bnd-file",
    key: ".bnd bond.chain",
    perOwner: true,
    what: "This device's copies of the BondChain histories (bch) it is a party to, with the inputs that re-derive their pairwise keys.",
  },
];

/** The record a browser storage key belongs to, or `undefined` for a stranger. */
export function placedStateForKey(key: string): PlacedState | undefined {
  return STATE_PLACEMENT.find((record) => {
    if (record.medium === "identity-service") return false;
    if (record.key === key) return true;
    return (
      record.perOwner &&
      (key.startsWith(`${record.key}.`) || key.startsWith(`${record.key}:`))
    );
  });
}

/** Every record placed at one tier, in table order. */
export function placedStateAt(
  placement: StatePlacement,
): readonly PlacedState[] {
  return STATE_PLACEMENT.filter((record) => record.placement === placement);
}
