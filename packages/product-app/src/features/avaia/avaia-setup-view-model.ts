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
export const AVAIA_ADDRESS_SUFFIX = "ai";

interface AvaiaAddressParts {
  /** The owner's immutable hexadecimal discriminator. */
  readonly prefix: string;
  /** Mutable UI portion before the protocol-required `ai` ending. */
  readonly slugStem: string;
  readonly suffix: typeof AVAIA_ADDRESS_SUFFIX;
}

/**
 * Stored Avaia addresses are already canonical service facts. Splitting them is
 * presentation only: it lets the editor keep contract-owned affixes outside
 * the text input without inventing a second address source of truth.
 */
function avaiaAddressParts(address: string): AvaiaAddressParts | undefined {
  const discriminator = address[0];
  if (
    discriminator === undefined ||
    !/^[0-9a-f]$/.test(discriminator) ||
    !address.endsWith(AVAIA_ADDRESS_SUFFIX)
  ) {
    return undefined;
  }

  return {
    prefix: discriminator,
    slugStem: address.slice(1, -AVAIA_ADDRESS_SUFFIX.length),
    suffix: AVAIA_ADDRESS_SUFFIX,
  };
}

/**
 * Build the service request from the canonical stored address and the only
 * mutable editor value. The allocated discriminator and required `ai` ending
 * are always inherited from contract-owned state, never from editable text.
 */
export function composeAvaiaPubDress(
  currentAddress: string,
  slugStem: string,
): string | undefined {
  const parts = avaiaAddressParts(currentAddress);
  if (parts === undefined) return undefined;
  return `${parts.prefix}${slugStem}${parts.suffix}`;
}

export interface AvaiaSetupViewState {
  /** The stored address, or the address this client last projected. */
  readonly address: string;
  /** Persisted owner decision. Absent while nothing has been read. */
  readonly configuration?: AvaiaConfigurationState;
  readonly configurationLabel: string;
  /** Contract-owned address text rendered outside the editable control. */
  readonly prefix: string;
  readonly suffix: typeof AVAIA_ADDRESS_SUFFIX;
  /** Only mutable UI state; the canonical Avaia slug still ends in `ai`. */
  readonly slugStem: string;
  /** Full candidate reconstructed only for comparison/service submission. */
  readonly candidatePubDress: string;
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
  /** Mutable editor state only; discriminator and `ai` never enter this draft. */
  readonly draftSlugStem?: string | undefined;
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
  const storedParts = avaiaAddressParts(address);
  const slugStem = input.draftSlugStem ?? storedParts?.slugStem ?? "";
  const candidatePubDress =
    storedParts === undefined
      ? address
      : `${storedParts.prefix}${slugStem}${storedParts.suffix}`;
  const editable = profile !== undefined && storedParts !== undefined;
  const changed = candidatePubDress !== address;
  const error =
    input.result === undefined ? undefined : saveError(input.result);
  const status = loadStatus(input.load);

  return {
    address,
    ...(profile === undefined
      ? {}
      : { configuration: profile.configurationState }),
    configurationLabel: configurationLabel(profile?.configurationState),
    prefix: storedParts?.prefix ?? "",
    suffix: AVAIA_ADDRESS_SUFFIX,
    slugStem,
    candidatePubDress,
    editable,
    busy: input.pending,
    canSave: editable && changed && !input.pending,
    note: "Case-sensitive · the owner discriminator and ai suffix are fixed by 0x1.",
    ...(status === undefined ? {} : { status }),
    ...(error === undefined ? {} : { error }),
  };
}
