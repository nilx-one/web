// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaConfigurationState,
  AvaiaProfileReadResult,
  AvaiaProfileUpdateResult,
} from "@nilx-one/application";

/**
 * What an owner may decide about the Avaia they own.
 *
 * One thing is written here: the address the identity service keeps. Whether a
 * device could run a model for this Avaia is a separate fact that never gates
 * this one — an Avaia is configured from wherever its owner happens to be
 * standing, including a device that could run nothing at all.
 */
export type AvaiaProfileLoadState =
  { kind: "unsupported" } | { kind: "loading" } | AvaiaProfileReadResult;

/** The model field the contract publishes no capability for. Read, never sent. */
export const AVAIA_MODEL_UNAVAILABLE = "Not available yet";

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
}

export interface AvaiaSetupInput {
  readonly load: AvaiaProfileLoadState;
  /** The address the identity projection already carries, if any. */
  readonly fallbackAddress?: string | undefined;
  readonly draft?: string | undefined;
  readonly pending: boolean;
  readonly result?: AvaiaProfileUpdateResult | undefined;
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
  };
}
