// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  ACTIVATION_PAYLOAD_FORMAT,
  ACTIVATION_PAYLOAD_VERSION,
  createActivationPayload,
  type ActivationPayloadStorage,
} from "./activation-payload";

const OWNER = "0x0sky";

function memoryStorage(
  entries: Record<string, string>,
): ActivationPayloadStorage & {
  readonly entries: Map<string, string>;
} {
  const map = new Map(Object.entries(entries));
  return {
    entries: map,
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

function decoded(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe("createActivationPayload", () => {
  it("carries only transport records, without their device-only fields", () => {
    const storage = memoryStorage({
      "nilx-one.interface.locale": "uk-UA",
      [`nilx-one.progression.v3.${OWNER}`]: JSON.stringify({
        xp: 40,
        deviceAchievements: ["first-walk"],
        settingsHintSeen: true,
      }),
      [`nilx-one.progression.v1.${OWNER}`]: "{}",
      [`nilx-one.fog.reveals.v1.someone-else`]: "[]",
      [`nilx-one.orbs.cells.v1.${OWNER}`]: "{}",
      "nilx-one.market.trip": "{}",
      "unplaced.key": "x",
    });
    expect(decoded(createActivationPayload(storage, OWNER).build())).toEqual({
      format: ACTIVATION_PAYLOAD_FORMAT,
      version: ACTIVATION_PAYLOAD_VERSION,
      records: [
        { key: "nilx-one.interface.locale", value: "uk-UA" },
        {
          key: `nilx-one.progression.v3.${OWNER}`,
          value: JSON.stringify({ xp: 40 }),
        },
      ],
    });
  });

  it("applies the records and keeps this device's own fields", () => {
    const from = memoryStorage({
      [`nilx-one.progression.v3.${OWNER}`]: JSON.stringify({
        xp: 90,
        settingsHintSeen: false,
      }),
      "nilx-one.interface.appearance": "dark",
    });
    const to = memoryStorage({
      [`nilx-one.progression.v3.${OWNER}`]: JSON.stringify({
        xp: 1,
        settingsHintSeen: true,
      }),
    });
    createActivationPayload(to, OWNER).apply(
      createActivationPayload(from, OWNER).build(),
    );
    expect(Object.fromEntries(to.entries)).toEqual({
      [`nilx-one.progression.v3.${OWNER}`]: JSON.stringify({
        xp: 90,
        settingsHintSeen: true,
      }),
      "nilx-one.interface.appearance": "dark",
    });
  });

  it("never writes a record that does not travel, and refuses another format", () => {
    const to = memoryStorage({});
    const payload = (records: unknown, version = ACTIVATION_PAYLOAD_VERSION) =>
      new TextEncoder().encode(
        JSON.stringify({ format: ACTIVATION_PAYLOAD_FORMAT, version, records }),
      );
    createActivationPayload(to, OWNER).apply(
      payload([
        { key: `avaia-finds/events`, value: "x" },
        { key: "nilx-one.local-model.choice", value: "x" },
        { key: `nilx-one.fog.reveals.v1.someone-else`, value: "[]" },
      ]),
    );
    expect(to.entries.size).toBe(0);
    expect(() =>
      createActivationPayload(to, OWNER).apply(payload([], 2)),
    ).toThrow();
    expect(() =>
      createActivationPayload(to, OWNER).apply(new Uint8Array([0xff])),
    ).toThrow();
  });
});
