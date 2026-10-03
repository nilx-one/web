// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Where each piece of persisted state lives today.
 *
 * `placement` is the residence of the bytes, and it agrees with `medium`.
 * A record in local storage is never `server`: the service does not hold it,
 * and calling it server state would invent an authority the identity contract
 * has not given it.
 *
 * - `server` — an identity-service table. The `pub_dress`, the server-side
 *   records a sign-in needs, the named study stored as
 *   `identities.avatar_model`, and `bond_pub_info`. Residence here means the
 *   bytes are in the service. For the identity records that is service
 *   authority. `bond_pub_info` is the exception: it holds the owner's
 *   cosmetic activity totals, labeled `authority: "client"` on the wire.
 *   Storing that report is not an attestation that the play happened.
 * - `device` — resident on this device. It does not travel: the on-device
 *   model and its download, the journal key, work in flight, an outfit the
 *   identity contract has no field for, and the `__Host-` cookies whose
 *   bytes the browser keeps.
 * - `synchronizable` — also resident on this device today. The word names
 *   transport eligibility, not a third store and not a fact of having synced.
 *   Synchronizable is not shared state, not protocol state, and not synced
 *   state. Nothing in this placement leaves the device until a later slice
 *   carries it device to device, end to end, with the service at most a blind
 *   relay.
 *
 * `mobility` says what that eligibility is. `transport` is an interface
 * preference or a play record a Bond may one day find on its other device.
 * `sealed-transport` is a different class: BondChain copies and the presence
 * journal, which already have their own lifecycle and move only under it.
 * They are not the same kind of thing as a chosen language.
 *
 * The architecture test reads this table against real `setItem` call sites,
 * so a key the client writes and nobody placed fails the build.
 */
export type StatePlacement = "server" | "device" | "synchronizable";

/**
 * `resident` stays where `placement` puts it.
 * `transport` may follow a Bond between its own devices; it is not synced
 * state.
 * `sealed-transport` is transport eligibility under the `.bnd` or presence
 * journal lifecycle only.
 */
export type StateMobility = "resident" | "transport" | "sealed-transport";

/** Where a record is kept today. */
export type StateMedium =
  | "identity-service"
  | "local-storage"
  | "indexed-db"
  | "model-cache"
  | "bnd-file"
  | "cookie";

export interface PlacedState {
  /** A stable name for the record, for prose and for the test's messages. */
  readonly id: string;
  readonly placement: StatePlacement;
  readonly mobility: StateMobility;
  readonly medium: StateMedium;
  /**
   * The storage key or key prefix in the browser, the table (and column) in
   * the service. Per-owner keys are listed without their owner suffix.
   */
  readonly key: string;
  /** The key is suffixed with the owning Bond's `pub_dress`. */
  readonly perOwner: boolean;
  /**
   * Read and folded into a newer key, never written. A migration source, not
   * a second copy the client maintains.
   */
  readonly legacy?: boolean;
  readonly what: string;
  /**
   * Fields of an otherwise transport-eligible record that are this device's
   * alone and are left behind when the record travels.
   */
  readonly deviceOnlyFields?: readonly string[];
}

export const STATE_PLACEMENT: readonly PlacedState[] = [
  // ─── server: identity-service tables ───────────────────────────────────
  {
    id: "identity.pubDress",
    placement: "server",
    mobility: "resident",
    medium: "identity-service",
    key: "identities.pub_dress",
    perOwner: false,
    what: "The Bond's address, its owned Avaia's address, and the public label folded from it.",
  },
  {
    id: "identity.authorization",
    placement: "server",
    mobility: "resident",
    medium: "identity-service",
    key: "identity_providers, native_credentials, native_sessions",
    perOwner: false,
    what: "The server-side records a sign-in needs: provider bindings, Argon2id verifiers, recovery keys, and session rows. The cookies that carry those credentials live on the device.",
  },
  {
    id: "identity.avatarModel",
    placement: "server",
    mobility: "resident",
    medium: "identity-service",
    key: "identities.avatar_model",
    perOwner: false,
    what: "The named study the identity service stores for a body. This repository does not define a customization identifier; that form belongs to a future identity contract.",
  },
  {
    id: "pubInfo.experience",
    placement: "server",
    mobility: "resident",
    medium: "identity-service",
    key: "bond_pub_info",
    perOwner: false,
    what: "Client-asserted cosmetic activity totals (bond_xp, avaia_xp) and the opaque event ids that keep a retry from paying twice. The wire labels every total authority: client. The service stores and redistributes the owner's report; it does not attest that the play happened.",
  },

  // ─── device: resident, never transported ───────────────────────────────
  {
    id: "identity.sessionCookie",
    placement: "device",
    mobility: "resident",
    medium: "cookie",
    key: "__Host-0x1_session",
    perOwner: false,
    what: "The browser's copy of the session credential. The row it names is native_sessions, which stays on the server.",
  },
  {
    id: "identity.rememberedBondCookie",
    placement: "device",
    mobility: "resident",
    medium: "cookie",
    key: "__Host-0x1_bond",
    perOwner: false,
    what: "The signed remembered-Bond hint. It is not a server table and it is not itself authentication.",
  },
  {
    id: "identity.oauthTransactionCookie",
    placement: "device",
    mobility: "resident",
    medium: "cookie",
    key: "__Host-0x1_oauth",
    perOwner: false,
    what: "The short-lived browser OAuth transaction. It does not outlive the sign-in it belongs to.",
  },
  {
    id: "identity.pendingProviderCookie",
    placement: "device",
    mobility: "resident",
    medium: "cookie",
    key: "__Host-0x1_provider",
    perOwner: false,
    what: "The short-lived pending provider binding, kept in the browser until the sign-in finishes.",
  },
  {
    id: "avatar.wardrobe",
    placement: "device",
    mobility: "resident",
    medium: "local-storage",
    key: "nilx-one.avatar.wardrobe",
    perOwner: false,
    what: "What a body wears, and which body an Avaia chose. The identity contract has no field for it, so it stays on this device.",
  },
  {
    id: "localModel.choice",
    placement: "device",
    mobility: "resident",
    medium: "local-storage",
    key: "nilx-one.localModel.choice",
    perOwner: false,
    what: "Which on-device model this device runs. Another device has its own memory, GPU and eligibility, so the choice means nothing there.",
  },
  {
    id: "interface.sound",
    placement: "device",
    mobility: "resident",
    medium: "local-storage",
    key: "nilx-one.interface.sound",
    perOwner: false,
    what: "Whether this device plays sound: off, effects, or effects and the world in view. Another device has its own speakers and stands somewhere else, so the choice means nothing there.",
  },
  {
    id: "interface.voice",
    placement: "device",
    mobility: "resident",
    medium: "local-storage",
    key: "nilx-one.interface.voice",
    perOwner: false,
    what: "Which characters speak aloud on this device: nobody, others in cutscenes, or the Avaia as well. Like sound itself, it is about these speakers and this room.",
  },
  {
    id: "wipe.epoch",
    placement: "device",
    mobility: "resident",
    medium: "local-storage",
    key: "nilx-one.wipe-epoch",
    perOwner: false,
    what: "Which full wipe this device has already applied, so a wipe runs once per browser and not on every load.",
  },
  {
    id: "localModel.download",
    placement: "device",
    mobility: "resident",
    medium: "model-cache",
    key: "@mlc-ai/web-llm cache",
    perOwner: false,
    what: "The downloaded model weights. Gigabytes this device fetched for itself.",
  },
  {
    id: "presence.journalKey",
    placement: "device",
    mobility: "resident",
    medium: "indexed-db",
    key: "nilx-presence/keys",
    perOwner: false,
    what: "The non-extractable key the presence journal is sealed with. Never transmitted, never derived from identity.",
  },
  {
    id: "fog.jobs",
    placement: "device",
    mobility: "resident",
    medium: "local-storage",
    key: "nilx-one.fog.jobs.v1",
    perOwner: true,
    what: "Reveals this device's Avaia has in flight. The revealed cell is what may travel; the timer that opens it is this device's work.",
  },

  // ─── transport-eligible: interface preferences ─────────────────────────
  {
    id: "interface.locale",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.interface.locale",
    perOwner: false,
    what: "The language a person chose, or auto.",
  },
  {
    id: "interface.appearance",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.interface.appearance",
    perOwner: false,
    what: "Light, dark, or follow the device.",
  },
  {
    id: "interface.dimension",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.interface.dimension",
    perOwner: false,
    what: "Whether the map is presented flat (2D) or volumetric (3D).",
  },

  // ─── transport-eligible: what a Bond earned and remembered ─────────────
  {
    id: "progression",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.progression.v3",
    perOwner: true,
    deviceOnlyFields: ["deviceAchievements", "settingsHintSeen"],
    what: "This device's unsent activity awards and the device-only model-download achievement. The shared totals are the separate client-asserted record in bond_pub_info, not this copy.",
  },
  {
    id: "progression.v2",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.progression.v2",
    perOwner: true,
    legacy: true,
    what: "The previous local progression key. Read once as unsent carry, never written.",
  },
  {
    id: "progression.v1",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.progression.v1",
    perOwner: true,
    legacy: true,
    what: "The first local progression key. Read once as unsent carry, less the old configuration reward, never written.",
  },
  {
    id: "fog.reveals",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.fog.reveals.v1",
    perOwner: true,
    what: "The cells a Bond or its Avaia opened.",
  },
  {
    id: "avaia.landmarks",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.avaia.landmarks.v1",
    perOwner: true,
    what: "Landmarks noticed in passing and studied by the Avaia.",
  },
  {
    id: "guide.intro",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.guide.v1",
    perOwner: true,
    what: "Whether xSasha's introduction was played through or skipped for this Bond.",
  },
  {
    id: "world.memory",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.world-memory.v1",
    perOwner: true,
    what: "Where the Bond and its Avaia were last seen: the position the world reopens on.",
  },
  {
    id: "bond.locationOverrides",
    placement: "synchronizable",
    mobility: "transport",
    medium: "local-storage",
    key: "nilx-one.bond-location-overrides.v1",
    perOwner: true,
    what: "Artificial presentation positions an owner declared for counterpart Bonds.",
  },

  // ─── sealed transport: own lifecycle, not an interface preference ──────
  {
    id: "presence.journal",
    placement: "synchronizable",
    mobility: "sealed-transport",
    medium: "indexed-db",
    key: "nilx-presence/visits",
    perOwner: false,
    what: "The sealed visit history (bond.journal). Eligible to move only under its own lifecycle, still sealed, and never through the service in the clear.",
  },
  {
    id: "bond.chain",
    placement: "synchronizable",
    mobility: "sealed-transport",
    medium: "bnd-file",
    key: ".bnd bond.chain",
    perOwner: true,
    what: "This device's copies of the BondChain histories (bch) it is a party to. Their lifecycle is the .bnd file's, not this table's.",
  },
];

/** The bytes' residence matches the medium that actually holds them. */
export function placementAgreesWithMedium(record: PlacedState): boolean {
  const onService = record.medium === "identity-service";
  return record.placement === "server" ? onService : !onService;
}

/** Transport eligibility is not claimed for a record that never leaves. */
export function mobilityAgreesWithPlacement(record: PlacedState): boolean {
  if (record.placement === "synchronizable") {
    return (
      record.mobility === "transport" || record.mobility === "sealed-transport"
    );
  }
  return record.mobility === "resident";
}

/** Drops a trailing run of `.` or `:` without a regular expression. */
function withoutTrailingSeparator(key: string): string {
  let end = key.length;
  while (end > 0) {
    const char = key[end - 1];
    if (char !== "." && char !== ":") break;
    end -= 1;
  }
  return key.slice(0, end);
}

/** The record a browser storage key belongs to, or `undefined` for a stranger. */
export function placedStateForKey(key: string): PlacedState | undefined {
  const normalized = withoutTrailingSeparator(key);
  return STATE_PLACEMENT.find((record) => {
    if (record.medium === "identity-service") return false;
    if (record.key === normalized) return true;
    return (
      record.perOwner &&
      (normalized.startsWith(`${record.key}.`) ||
        normalized.startsWith(`${record.key}:`))
    );
  });
}

/** Every record placed at one tier, in table order. */
export function placedStateAt(
  placement: StatePlacement,
): readonly PlacedState[] {
  return STATE_PLACEMENT.filter((record) => record.placement === placement);
}
