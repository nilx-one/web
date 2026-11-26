// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  applyParkedPayload,
  downloadActivationPayload,
  parkActivationPayload,
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
      parked: null,
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
    parkActivationPart: unexpected,
    downloadParkedPart: unexpected,
    acknowledgeParked: unexpected,
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

function activeWith(parked: { totalBytes: number; digest: string } | null) {
  return {
    kind: "state" as const,
    view: {
      state: "authenticated_active" as const,
      active: true,
      mayAct: true,
      clientLabel: "Mac · Safari",
      activeClientLabel: null,
      request: null,
      parked,
    },
  };
}

describe("parkActivationPayload", () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  it("parks every part from the first and checks the digest the back-end holds", async () => {
    const sent: [number, number, number[]][] = [];
    const reading = await parkActivationPayload({
      access: access({
        parkActivationPart: async (offset, total, bytes) => {
          sent.push([offset, total, [...bytes]]);
          return activeWith(
            offset + bytes.length === total
              ? { totalBytes: total, digest: `digest:${total}` }
              : null,
          );
        },
      }),
      core,
      payload,
    });
    expect(sent).toEqual([
      [0, 10, [1, 2, 3, 4]],
      [4, 10, [5, 6, 7, 8]],
      [8, 10, [9, 10]],
    ]);
    expect(reading.kind).toBe("state");
  });

  it("is not parked when the back-end holds another digest or refuses", async () => {
    const other = await parkActivationPayload({
      access: access({
        parkActivationPart: async () =>
          activeWith({ totalBytes: 10, digest: "digest:other" }),
      }),
      core,
      payload,
    });
    expect(other).toEqual({ kind: "unavailable" });
    const refused = await parkActivationPayload({
      access: access({
        parkActivationPart: async () => ({
          kind: "refused",
          reason: "activation_step_refused",
        }),
      }),
      core,
      payload,
    });
    expect(refused).toEqual({
      kind: "refused",
      reason: "activation_step_refused",
    });
  });
});

describe("applyParkedPayload", () => {
  const source = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const parked = {
    totalBytes: source.length,
    digest: `digest:${source.length}`,
  };
  const download = async (offset: number) => ({
    kind: "bytes" as const,
    bytes: source.slice(offset, offset + PART),
  });

  it("fetches, applies, then acknowledges with the announced digest", async () => {
    const applied: number[][] = [];
    const acknowledge = vi.fn(async () => activeWith(null));
    const reading = await applyParkedPayload({
      access: access({
        downloadParkedPart: download,
        acknowledgeParked: acknowledge,
      }),
      core,
      parked,
      payload: {
        build: () => new Uint8Array(),
        apply: (bytes) => {
          applied.push([...bytes]);
        },
      },
    });
    expect(applied).toEqual([[9, 8, 7, 6, 5, 4]]);
    expect(acknowledge).toHaveBeenCalledWith(parked.digest);
    expect(reading).toEqual(activeWith(null));
  });

  it("never applies or acknowledges bytes that are not the announced whole", async () => {
    const acknowledge = vi.fn();
    const apply = vi.fn();
    const reading = await applyParkedPayload({
      access: access({
        downloadParkedPart: download,
        acknowledgeParked: acknowledge,
      }),
      core,
      parked: { ...parked, digest: "digest:other" },
      payload: { build: () => new Uint8Array(), apply },
    });
    expect(reading).toEqual({ kind: "unavailable" });
    expect(apply).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("leaves the data parked when it does not apply", async () => {
    const acknowledge = vi.fn();
    const reading = await applyParkedPayload({
      access: access({
        downloadParkedPart: download,
        acknowledgeParked: acknowledge,
      }),
      core,
      parked,
      payload: {
        build: () => new Uint8Array(),
        apply: () => {
          throw new Error("unsupported");
        },
      },
    });
    expect(reading).toEqual({ kind: "unavailable" });
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
