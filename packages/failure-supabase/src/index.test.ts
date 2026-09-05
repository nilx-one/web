// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { createFailureRecord } from "@nilx-one/application";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseFailureSink } from "./index";

const record = createFailureRecord({
  report: { code: "style-load-failed", kind: "unavailable", retryable: true },
  surface: "web-client",
  component: "map-renderer",
  recordedAtUnixMs: 1_767_225_600_000,
});

function sink(
  fetchImpl: ReturnType<typeof vi.fn>,
  onDropped?: (...args: never[]) => void,
) {
  return createSupabaseFailureSink({
    url: "https://project.supabase.co/",
    apiKey: "anon-key",
    fetch: fetchImpl as never,
    ...(onDropped === undefined ? {} : { onDropped: onDropped as never }),
  });
}

describe("createSupabaseFailureSink", () => {
  it("posts the row to the versioned table endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201 }));

    sink(fetchImpl).record(record);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://project.supabase.co/rest/v1/failure_records");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("anon-key");
    expect(init.headers.authorization).toBe("Bearer anon-key");
    expect(init.headers.prefer).toBe("return=minimal");
    expect(JSON.parse(init.body)).toEqual(record);
  });

  it("builds one endpoint however many trailing slashes the URL carries", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201 }));

    createSupabaseFailureSink({
      url: "https://project.supabase.co//////",
      apiKey: "anon-key",
      fetch: fetchImpl as never,
    }).record(record);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://project.supabase.co/rest/v1/failure_records");
  });

  it("survives a page the failure is about to take down", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201 }));

    sink(fetchImpl).record(record);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { keepalive?: boolean },
    ];
    expect(init.keepalive).toBe(true);
  });

  it("reports a rejected delivery instead of turning one failure into two", async () => {
    const onDropped = vi.fn();
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });

    expect(() => sink(fetchImpl, onDropped).record(record)).not.toThrow();
    await vi.waitFor(() => expect(onDropped).toHaveBeenCalledOnce());
    expect(onDropped).toHaveBeenCalledWith(record, "offline");
  });

  it("reports a refused write without raising it to the caller", async () => {
    const onDropped = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));

    sink(fetchImpl, onDropped).record(record);
    await vi.waitFor(() => expect(onDropped).toHaveBeenCalledOnce());
    expect(onDropped).toHaveBeenCalledWith(record, "http-401");
  });

  it("stays silent when no drop handler is given", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));

    expect(() => sink(fetchImpl).record(record)).not.toThrow();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
  });
});
