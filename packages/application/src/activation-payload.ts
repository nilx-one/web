// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { ActivationPayloadPort } from "./client-activation";
import { placedStateForKey, type PlacedState } from "./state-placement";

/**
 * What a client activation carries from the active device to the asking one.
 * Core never reads these bytes; both clients must agree on them, so the
 * format is named and versioned.
 *
 * In: the records `STATE_PLACEMENT` marks `synchronizable` with mobility
 * `transport`, minus each record's `deviceOnlyFields`. Out, always: legacy
 * migration sources, everything `sealed-transport` (BondChain copies, the
 * presence journal, the committed award and find journal and their keys),
 * everything placed `device`, and every cookie or token.
 */
export const ACTIVATION_PAYLOAD_FORMAT = "nilx-one.activation-payload";
export const ACTIVATION_PAYLOAD_VERSION = 1;

interface PayloadRecord {
  readonly key: string;
  readonly value: string;
}

interface Payload {
  readonly format: typeof ACTIVATION_PAYLOAD_FORMAT;
  readonly version: typeof ACTIVATION_PAYLOAD_VERSION;
  readonly records: readonly PayloadRecord[];
}

export type ActivationPayloadStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem"
>;

function travels(record: PlacedState | undefined): record is PlacedState {
  return (
    record !== undefined &&
    record.placement === "synchronizable" &&
    record.mobility === "transport" &&
    record.medium === "local-storage" &&
    record.legacy !== true
  );
}

function ownedBy(key: string, record: PlacedState, owner: string): boolean {
  if (!record.perOwner) return key === record.key;
  return key === `${record.key}.${owner}` || key === `${record.key}:${owner}`;
}

function transportRecord(key: string, owner: string): PlacedState | undefined {
  const record = placedStateForKey(key);
  return travels(record) && ownedBy(key, record, owner) ? record : undefined;
}

function objectOf(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function withoutDeviceFields(record: PlacedState, value: string): string {
  const fields = record.deviceOnlyFields;
  if (fields === undefined || fields.length === 0) return value;
  const object = objectOf(value);
  if (object === undefined) return value;
  const travelling = { ...object };
  for (const field of fields) delete travelling[field];
  return JSON.stringify(travelling);
}

function withLocalDeviceFields(
  record: PlacedState,
  incoming: string,
  local: string | null,
): string {
  const fields = record.deviceOnlyFields;
  if (fields === undefined || fields.length === 0 || local === null)
    return incoming;
  const arriving = objectOf(incoming);
  const resident = objectOf(local);
  if (arriving === undefined || resident === undefined) return incoming;
  const merged = { ...arriving };
  for (const field of fields)
    if (Object.hasOwn(resident, field)) merged[field] = resident[field];
  return JSON.stringify(merged);
}

function decode(bytes: Uint8Array): Payload {
  const parsed = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Partial<Payload>).format !== ACTIVATION_PAYLOAD_FORMAT ||
    (parsed as Partial<Payload>).version !== ACTIVATION_PAYLOAD_VERSION ||
    !Array.isArray((parsed as Partial<Payload>).records)
  )
    throw new Error("Unsupported activation payload");
  const records = (parsed as Payload).records;
  for (const record of records)
    if (typeof record?.key !== "string" || typeof record.value !== "string")
      throw new Error("Invalid activation payload record");
  return parsed as Payload;
}

/** The payload port for one Bond's records in this browser's local storage. */
export function createActivationPayload(
  storage: ActivationPayloadStorage,
  owner: string,
): ActivationPayloadPort {
  return {
    build() {
      const records: PayloadRecord[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key === null) continue;
        const record = transportRecord(key, owner);
        const value = record === undefined ? null : storage.getItem(key);
        if (record === undefined || value === null) continue;
        records.push({ key, value: withoutDeviceFields(record, value) });
      }
      records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const payload: Payload = {
        format: ACTIVATION_PAYLOAD_FORMAT,
        version: ACTIVATION_PAYLOAD_VERSION,
        records,
      };
      return new TextEncoder().encode(JSON.stringify(payload));
    },
    apply(bytes) {
      const { records } = decode(bytes);
      const writes: PayloadRecord[] = [];
      for (const { key, value } of records) {
        const record = transportRecord(key, owner);
        if (record === undefined) continue;
        writes.push({
          key,
          value: withLocalDeviceFields(record, value, storage.getItem(key)),
        });
      }
      for (const { key, value } of writes) storage.setItem(key, value);
    },
  };
}
