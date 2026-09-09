// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaConfigurationState,
  AvaiaProfileReadResult,
  AvaiaProfileUpdateResult,
  AvatarModel,
} from "@nilx-one/application";
import { avatarPreviewUrl } from "@nilx-one/map-contract";

import { avatarStudy } from "../identity/avatar-choice-view-model";
import type { AvaiaAvailability } from "../map/bond-dock-view-model";

/**
 * What an owner may decide about the Avaia they own, and what they may only be
 * told.
 *
 * Three things are named here and none of them is the other two. The address is
 * identity: the owner writes it and the service keeps it. The AI model is this
 * device's runtime: it is read, never written, and its absence never stops the
 * address from being edited. The render model is how the Avaia appears in the
 * shared world, which has nothing to do with which model, if any, thinks for
 * it. Nothing on this surface is an interaction between two Bonds.
 */
export type AvaiaProfileLoadState =
  { kind: "unsupported" } | { kind: "loading" } | AvaiaProfileReadResult;

export interface AvaiaRuntimeFieldViewState {
  /** Read-only device runtime state, presented beside the identity it serves. */
  readonly value: string;
  readonly note: string;
}

export interface AvaiaRenderFieldViewState {
  readonly value: string;
  readonly note: string;
  readonly study?: {
    readonly model: AvatarModel;
    readonly name: string;
    readonly detail: string;
    readonly previewUrl: string;
  };
}

export interface AvaiaSetupViewState {
  /** The stored address, or the address this client last projected. */
  readonly address: string;
  /** Persisted owner decision. Absent while nothing has been read. */
  readonly configuration?: AvaiaConfigurationState;
  readonly configurationLabel: string;
  /** The whole address being written, which is the stored one until typed. */
  readonly draft: string;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly note: string;
  /** What is true of the read itself, when that is worth saying. */
  readonly status?: string;
  readonly error?: string;
  /** The address the last accepted save produced, for confirmation. */
  readonly saved?: string;
  readonly aiModel: AvaiaRuntimeFieldViewState;
  readonly renderModel: AvaiaRenderFieldViewState;
}

export interface AvaiaSetupInput {
  readonly load: AvaiaProfileLoadState;
  /** The address the identity projection already carries, if any. */
  readonly fallbackAddress?: string | undefined;
  readonly draft?: string | undefined;
  readonly pending: boolean;
  readonly result?: AvaiaProfileUpdateResult | undefined;
  /** What this device can do about the runtime. Never identity state. */
  readonly availability: AvaiaAvailability;
  /** The study the world draws this Avaia as, when one is drawn at all. */
  readonly study?: AvatarModel | undefined;
}

function loadStatus(load: AvaiaProfileLoadState): string | undefined {
  switch (load.kind) {
    case "loading":
      return "Reading this Avaia…";
    case "authentication-required":
      return "Sign in again to change this Avaia.";
    case "service-unavailable":
      return "This Avaia can’t be read right now. Try again.";
    case "unsupported":
      return "This host cannot configure an Avaia yet.";
    case "available":
      return undefined;
  }
}

function saveError(result: AvaiaProfileUpdateResult): string | undefined {
  if (result.kind === "service-unavailable") {
    return "Couldn’t save this address. Try again.";
  }
  if (result.kind !== "rejected") return undefined;
  switch (result.reason) {
    case "authentication-required":
      return "Sign in again to change this Avaia.";
    case "invalid-address":
      return "That is not an address an Avaia can hold.";
    case "owner-discriminator-mismatch":
      return "An Avaia keeps the discriminator of the Bond that owns it.";
    case "unavailable":
      return "That address belongs to another identity.";
    case "rate-limited":
      return "Too many changes. Wait before trying again.";
  }
}

function configurationLabel(
  configuration: AvaiaConfigurationState | undefined,
): string {
  switch (configuration) {
    case "configured":
      return "configured";
    case "unconfigured":
      return "unconfigured";
    case undefined:
      return "not read";
  }
}

/**
 * The runtime this device could give the Avaia. No runtime is published yet, so
 * every device answers the same thing — and it says so as a device fact rather
 * than as something missing from the identity.
 */
function runtimeField(
  availability: AvaiaAvailability,
): AvaiaRuntimeFieldViewState {
  const note =
    "The model that thinks for this Avaia runs on the device it is opened on. It is not part of who the Avaia is.";
  switch (availability) {
    case "ready":
      return { value: "Ready on this device", note };
    case "preparing":
      return { value: "Preparing on this device", note };
    case "downloadable":
      return { value: "Ready to download", note };
    case "unavailable":
      return { value: "Not available yet", note };
  }
}

/**
 * How the Avaia looks, which is a separate question from what runs it. The
 * world already draws a body for an Avaia; this states which one, and stops
 * there until the traits it will hold are published.
 */
function renderField(
  study: AvatarModel | undefined,
): AvaiaRenderFieldViewState {
  const note =
    "How this Avaia appears in the shared world. Choosing its body, hair, face and skin comes later.";
  if (study === undefined) {
    return { value: "Not drawn yet", note };
  }
  const named = avatarStudy(study);
  return {
    value: `${named.name} — ${named.detail}`,
    note,
    study: {
      model: study,
      name: named.name,
      detail: named.detail,
      previewUrl: avatarPreviewUrl(study),
    },
  };
}

export function createAvaiaSetupViewState(
  input: AvaiaSetupInput,
): AvaiaSetupViewState {
  const profile =
    input.load.kind === "available" ? input.load.profile : undefined;
  const address = profile?.pubDress ?? input.fallbackAddress ?? "";
  const draft = input.draft ?? address;
  const editable = profile !== undefined;
  const changed = draft !== address;
  const error =
    input.result === undefined ? undefined : saveError(input.result);
  const status = loadStatus(input.load);
  // A save is confirmed only once this surface already reads the address the
  // service answered with, so a confirmation can never describe a stale draft.
  const saved =
    input.result?.kind === "updated" &&
    input.result.profile.pubDress === address
      ? address
      : undefined;

  return {
    address,
    ...(profile === undefined
      ? {}
      : { configuration: profile.configurationState }),
    configurationLabel: configurationLabel(profile?.configurationState),
    draft,
    editable,
    busy: input.pending,
    canSave: editable && changed && draft.trim().length > 0 && !input.pending,
    note: "0x1 keeps the whole address. It carries this Bond’s discriminator and ends in ai.",
    ...(status === undefined ? {} : { status }),
    ...(error === undefined ? {} : { error }),
    ...(saved === undefined ? {} : { saved }),
    aiModel: runtimeField(input.availability),
    renderModel: renderField(input.study),
  };
}
