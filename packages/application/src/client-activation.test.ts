// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  downloadActivationPayload,
  uploadActivationPayload,
  type ActivationReading,
  type ActivationSyncCore,
  type ClientActivationAccessPort,
  type ClientActivationState,
} from "./client-activation";

const ID = "0123456789abcdef0123456789abcdef";
const PART = 4;

/** Stands in for Core's part cutter: four-byte parts, `none` past the end. */
const core: ActivationSyncCore = {
  activationSyncPart: async (total, offset) =>
    offset > total || (offset === total && total !== 0)
      ? { kind: "none" }
      : {
          kind: "part",
          offset,
          end: Math.min(total, offset + PART),
          last: offset + PART >= total,
        },
  activationSyncDigest: async (data) => `digest:${data.length}`,
};

function state(
  name: ClientActivationState,
  uploadedBytes = 0,
  totalBytes: number | null = null,
): ActivationReading {
  return {
    kind: "state",
    view: {
      state: name,
      active: true,
      mayAct: false,
      clientLabel: "iPhone · Telegram",
      activeClientLabel: null,
      request: {
        id: ID,
        role: "approver",
        status: "approved",
        fromLabel: "iPhone · Telegram",
        toLabel: "Mac · Safari",
        createdAt: 1,
        deadline: 2,
        progress: {
          steps: [],
          percent: 0,
          totalBytes,
          uploadedBytes,
          deliveredBytes: 0,
        },
      },
    },
  };
}

function access(
  overrides: Partial<ClientActivationAccessPort>,
): ClientActivationAccessPort {
  const unexpected = async () => {
    throw new Error("unexpected call");
  };
  return {
    readActivationState: unexpected,
    requestActivation: unexpected,
    cancelActivation: unexpected,
    approveActivation: unexpected,
    declineActivation: unexpected,
    uploadActivationSyncPart: unexpected,
    downloadActivationSyncPart: unexpected,
    completeActivation: unexpected,
    ...overrides,
  };
}

describe("uploadActivationPayload", () => {
  it("sends from Core's count until Core stops asking for the upload", async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const sent: [number, number, number[]][] = [];
    const upload = vi.fn(
      async (_id: string, offset: number, total: number, bytes: Uint8Array) => {
        sent.push([offset, total, [...bytes]]);
        const counted = offset + bytes.length;
        return counted === total
          ? state("handoff_syncing", counted, total)
          : state("upload_required", counted, total);
      },
    );
    const reading = await uploadActivationPayload({
      access: access({ uploadActivationSyncPart: upload }),
      core,
      requestId: ID,
      payload,
      uploadedBytes: 4,
    });
    expect(sent).toEqual([
      [4, 10, [5, 6, 7, 8]],
      [8, 10, [9, 10]],
    ]);
    expect(reading.kind === "state" && reading.view.state).toBe(
      "handoff_syncing",
    );
  });

  it("sends an empty payload as one empty part", async () => {
    const upload = vi.fn(async () => state("handoff_syncing", 0, 0));
    await uploadActivationPayload({
      access: access({ uploadActivationSyncPart: upload }),
      core,
      requestId: ID,
      payload: new Uint8Array(),
      uploadedBytes: 0,
    });
    expect(upload).toHaveBeenCalledWith(ID, 0, 0, new Uint8Array());
  });

  it("stops at a refusal and leaves the next state read to say where to go on", async () => {
    const reading = await uploadActivationPayload({
      access: access({
        uploadActivationSyncPart: async () => ({
          kind: "refused",
          reason: "sync_out_of_order",
        }),
      }),
      core,
      requestId: ID,
      payload: new Uint8Array(8),
      uploadedBytes: 0,
    });
    expect(reading).toEqual({ kind: "refused", reason: "sync_out_of_order" });
  });
});

describe("downloadActivationPayload", () => {
  const source = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const download = async (_id: string, offset: number) => ({
    kind: "bytes" as const,
    bytes: source.slice(offset, offset + PART),
  });

  it("fetches every part from the first, applies, then completes", async () => {
    const order: string[] = [];
    const applied: number[][] = [];
    const complete = vi.fn(async () => {
      order.push("complete");
      return state("authenticated_active");
    });
    const reading = await downloadActivationPayload({
      access: access({
        downloadActivationSyncPart: download,
        completeActivation: complete,
      }),
      core,
      requestId: ID,
      totalBytes: source.length,
      payload: {
        build: () => new Uint8Array(),
        apply: (bytes) => {
          order.push("apply");
          applied.push([...bytes]);
        },
      },
    });
    expect(applied).toEqual([[...source]]);
    expect(order).toEqual(["apply", "complete"]);
    expect(complete).toHaveBeenCalledWith(ID, "digest:9");
    expect(reading.kind === "state" && reading.view.state).toBe(
      "authenticated_active",
    );
  });

  it("never completes when the payload does not apply", async () => {
    const complete = vi.fn();
    const reading = await downloadActivationPayload({
      access: access({
        downloadActivationSyncPart: download,
        completeActivation: complete,
      }),
      core,
      requestId: ID,
      totalBytes: source.length,
      payload: {
        build: () => new Uint8Array(),
        apply: () => {
          throw new Error("unsupported");
        },
      },
    });
    expect(reading).toEqual({ kind: "unavailable" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("stops on a short part instead of completing with a hole", async () => {
    const complete = vi.fn();
    const reading = await downloadActivationPayload({
      access: access({
        downloadActivationSyncPart: async () => ({
          kind: "bytes",
          bytes: new Uint8Array(1),
        }),
        completeActivation: complete,
      }),
      core,
      requestId: ID,
      totalBytes: source.length,
      payload: { build: () => new Uint8Array(), apply: () => undefined },
    });
    expect(reading).toEqual({ kind: "unavailable" });
    expect(complete).not.toHaveBeenCalled();
  });
});
