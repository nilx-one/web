// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { FailureRecord, FailureSinkPort } from "@nilx-one/application";

export const DEFAULT_FAILURE_TABLE = "failure_records";

type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    keepalive?: boolean;
  },
) => Promise<{ ok: boolean; status: number }>;

export interface SupabaseFailureSinkOptions {
  /** Supabase project URL, for example `https://<ref>.supabase.co`. */
  readonly url: string;
  /**
   * The project's anon key. It is public by design and is safe in a client
   * bundle only because row level security decides what it may do; the
   * service role key must never reach a browser.
   */
  readonly apiKey: string;
  readonly table?: string;
  readonly fetch?: FetchLike;
  /** Called when a record could not be delivered. Never called with secrets. */
  readonly onDropped?: (record: FailureRecord, reason: string) => void;
}

/**
 * A failure sink backed by the Supabase REST endpoint.
 *
 * Recording never throws and never rejects. A sink that could fail loudly
 * would turn one failure into two, and the surface calling it is already
 * handling something that went wrong.
 */
export function createSupabaseFailureSink(
  options: SupabaseFailureSinkOptions,
): FailureSinkPort {
  const table = options.table ?? DEFAULT_FAILURE_TABLE;
  const endpoint = `${options.url.replace(/\/+$/, "")}/rest/v1/${table}`;
  const send: FetchLike =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  function drop(record: FailureRecord, reason: string): void {
    options.onDropped?.(record, reason);
  }

  return {
    record(record) {
      let delivery: Promise<{ ok: boolean; status: number }>;

      try {
        delivery = send(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: options.apiKey,
            authorization: `Bearer ${options.apiKey}`,
            // The row is written for an operator to read later, not returned
            // to a client that is already handling a failure.
            prefer: "return=minimal",
          },
          body: JSON.stringify(record),
          // Survives a page the failure is about to take down.
          keepalive: true,
        });
      } catch (error) {
        drop(record, error instanceof Error ? error.message : "send-threw");
        return;
      }

      void delivery.then(
        (response) => {
          if (!response.ok) {
            drop(record, `http-${response.status}`);
          }
        },
        (error: unknown) => {
          drop(
            record,
            error instanceof Error ? error.message : "send-rejected",
          );
        },
      );
    },
  };
}
