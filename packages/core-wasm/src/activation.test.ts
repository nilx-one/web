// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { decodeActivationReading, decodeActivationSyncPart } from "./index";

interface ActivationRuntime {
  initSync(input: { module: Uint8Array }): unknown;
  read_activation_state(ok: boolean, body: string): string;
  activation_sync_part(totalBytes: string, offset: string): string;
  activation_sync_digest(data: Uint8Array): string;
}

const coreRuntime = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../apps/site/public/core/0.1.0",
);
const runtime = (await import(
  /* @vite-ignore */ pathToFileURL(join(coreRuntime, "index.js")).href
)) as ActivationRuntime;
runtime.initSync({ module: readFileSync(join(coreRuntime, "index_bg.wasm")) });

const SYNCING = JSON.stringify({
  state: "activation_syncing",
  active: false,
  may_act: false,
  client_label: "Mac · Safari",
  active_client_label: "iPhone · Telegram",
  request: {
    id: "0123456789abcdef0123456789abcdef",
    role: "requester",
    status: "syncing",
    from_label: "iPhone · Telegram",
    to_label: "Mac · Safari",
    created_at: 1800000000,
    deadline: 1800000700,
    progress: {
      steps: [
        { step: "confirm", state: "done" },
        { step: "sync", state: "current" },
        { step: "switch", state: "waiting" },
      ],
      percent: 78,
      total_bytes: 1048576,
      uploaded_bytes: 1048576,
      delivered_bytes: 614400,
    },
  },
});

describe("Core's reading of client activation", () => {
  it("renames the state Core read and draws nothing of its own", () => {
    expect(
      decodeActivationReading(runtime.read_activation_state(true, SYNCING)),
    ).toEqual({
      kind: "state",
      view: {
        state: "activation_syncing",
        active: false,
        mayAct: false,
        clientLabel: "Mac · Safari",
        activeClientLabel: "iPhone · Telegram",
        request: {
          id: "0123456789abcdef0123456789abcdef",
          role: "requester",
          status: "syncing",
          fromLabel: "iPhone · Telegram",
          toLabel: "Mac · Safari",
          createdAt: 1800000000,
          deadline: 1800000700,
          progress: {
            steps: [
              { step: "confirm", state: "done" },
              { step: "sync", state: "current" },
              { step: "switch", state: "waiting" },
            ],
            percent: 78,
            totalBytes: 1048576,
            uploadedBytes: 1048576,
            deliveredBytes: 614400,
          },
        },
      },
    });
  });

  it("keeps Core's refusals, sign-in and unavailable answers apart", () => {
    const refusal = (code: string) =>
      JSON.stringify({ error: { code, message: "-" } });
    expect(
      decodeActivationReading(
        runtime.read_activation_state(false, refusal("sync_out_of_order")),
      ),
    ).toEqual({ kind: "refused", reason: "sync_out_of_order" });
    expect(
      decodeActivationReading(
        runtime.read_activation_state(
          false,
          refusal("provider_authentication_required"),
        ),
      ),
    ).toEqual({ kind: "authentication-required" });
    expect(
      decodeActivationReading(runtime.read_activation_state(false, SYNCING)),
    ).toEqual({ kind: "unavailable" });
    const disagreeing = SYNCING.replace('"may_act":false', '"may_act":true');
    expect(
      decodeActivationReading(runtime.read_activation_state(true, disagreeing)),
    ).toEqual({ kind: "unavailable" });
  });

  it("cuts parts and digests with Core", () => {
    expect(
      decodeActivationSyncPart(
        runtime.activation_sync_part("600000", "524288"),
      ),
    ).toEqual({ kind: "part", offset: 524288, end: 600000, last: true });
    expect(
      decodeActivationSyncPart(runtime.activation_sync_part("0", "0")),
    ).toEqual({ kind: "part", offset: 0, end: 0, last: true });
    expect(
      decodeActivationSyncPart(runtime.activation_sync_part("600000", "01")),
    ).toEqual({ kind: "none" });
    expect(
      runtime.activation_sync_digest(new TextEncoder().encode("abc")),
    ).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("refuses a reading Core never gives", () => {
    for (const reading of [
      '{"kind":"state","state":"playing","active":true,"may_act":true,"request":null}',
      '{"kind":"refused","reason":"maybe"}',
      '{"kind":"switched"}',
      "null",
    ])
      expect(() => decodeActivationReading(reading)).toThrow();
    expect(() => decodeActivationSyncPart('{"kind":"part"}')).toThrow();
  });
});
