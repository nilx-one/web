// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The wire form of the Avaia's drive in 0x1 Core (`docs/avaia-drive.md` in
 * core): what the host tells it, and what it answers the host to carry out.
 *
 * Core decides what the Avaia does next; the host only resolves the ground
 * into opaque refs and whole metres, and carries out the commands. No place,
 * name or coordinate crosses this boundary: a ref is whatever the host's
 * world layer minted, and Core only ever hands one back.
 */

export type AvaiaDrivePurpose =
  "tap" | "curiosity" | "outing" | "wander" | "home" | "stroll" | "detour";

export type AvaiaDriveGroup = "landmark" | "area" | "find";

export type AvaiaDriveFeeling = "new" | "known" | "fond" | "loved";

export type AvaiaDriveLifeIntent = "explore" | "return_home" | "recover";

export type AvaiaDriveAction =
  "carry_on" | "glance" | "pick_up" | "stay" | "go" | "wander" | "home";

export type AvaiaDriveLine =
  | "walk"
  | "stroll"
  | "landmark.spotted"
  | "landmark.longing"
  | "blocked.building"
  | "blocked.water"
  | "blocked.fog";

/** Something on the way the world layer perceived. */
export interface AvaiaDrivePassing {
  readonly ref: string;
  readonly kind: string;
  readonly group: AvaiaDriveGroup;
  readonly off_route_m: number;
  readonly studyable?: boolean;
}

/** A target an outing may go to. */
export interface AvaiaDriveTarget {
  readonly ref: string;
  readonly kind: string;
  readonly meters: number;
  readonly appeal?: number;
  readonly feeling?: AvaiaDriveFeeling;
  /** Milliseconds as a decimal string, as Core's u64s travel. */
  readonly stay_ms?: string;
  readonly revisit_ms?: string;
}

/** What happened, as the host tells the drive. */
export type AvaiaDriveInput =
  | { readonly type: "tap"; readonly to: string }
  | { readonly type: "arrived" }
  | {
      readonly type: "blocked";
      readonly by?: "building" | "water" | "fog";
    }
  | { readonly type: "stopped" }
  | { readonly type: "tick" }
  | { readonly type: "passing"; readonly things: readonly AvaiaDrivePassing[] }
  | {
      readonly type: "curiosity_options";
      readonly to: readonly {
        readonly ref: string;
        readonly longing?: boolean;
      }[];
    }
  | { readonly type: "stroll_options"; readonly to: readonly string[] }
  | {
      readonly type: "outing_options";
      readonly targets: readonly AvaiaDriveTarget[];
      readonly wander: readonly string[];
      readonly home?: { readonly ref: string; readonly meters: number };
    }
  | {
      readonly type: "life";
      readonly intent: AvaiaDriveLifeIntent;
      readonly energy: string;
      readonly home?: string;
    }
  | { readonly type: "chosen"; readonly index: number | null };

/** One option of a menu, as a model reads it. */
export interface AvaiaDriveMenuOption {
  readonly index: number;
  readonly action: AvaiaDriveAction;
  readonly kind?: string;
  readonly reach?: "near" | "far";
  readonly feeling?: AvaiaDriveFeeling;
}

/** What the host carries out. */
export type AvaiaDriveCommand =
  | {
      readonly do: "walk";
      readonly to: string;
      readonly purpose: AvaiaDrivePurpose;
      readonly grass: boolean;
    }
  | { readonly do: "look"; readonly ms: number }
  | { readonly do: "study"; readonly at: string }
  | { readonly do: "glance"; readonly at: string }
  | { readonly do: "pick_up"; readonly at: string }
  | { readonly do: "visited"; readonly at: string }
  | {
      readonly do: "say";
      readonly line: AvaiaDriveLine;
      readonly about?: string;
    }
  | {
      readonly do: "resolve";
      readonly what: "curiosity" | "stroll" | "outing";
      readonly min_m: number;
      readonly max_m: number;
      readonly leash_m?: number;
      readonly anchor?: string;
      readonly wander_m?: readonly [number, number];
    }
  | {
      readonly do: "choose";
      readonly what: "distraction" | "outing";
      readonly heading?: AvaiaDrivePurpose;
      readonly menu: readonly AvaiaDriveMenuOption[];
      readonly default: number;
    }
  | { readonly do: "wake_at"; readonly ms: number };

/**
 * Core's answer to one drive step. `state` is the next stored drive, opaque
 * here: only Core reads it.
 */
export type AvaiaDriveAnswer =
  | {
      readonly ok: true;
      readonly state: string;
      readonly commands: readonly AvaiaDriveCommand[];
    }
  | { readonly ok: false; readonly error: string };
