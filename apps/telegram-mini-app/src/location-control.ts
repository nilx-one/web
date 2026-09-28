// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  bondLocationControlFingerprint,
  readBondLocationControl,
  type BondLocationControlState,
} from "@nilx-one/identity-http";

export type TelegramLocationControlState = BondLocationControlState;

interface TelegramLocationControlReadOptions {
  readonly timeoutMs?: number;
}

/**
 * Reads authenticated Bond location control before the world is composed.
 * See `readBondLocationControl`: anything but a definite answer fails closed.
 */
export async function readTelegramLocationControl(
  initData: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  options: TelegramLocationControlReadOptions = {},
): Promise<TelegramLocationControlState> {
  if (initData.length === 0) {
    return { kind: "unavailable" };
  }
  return readBondLocationControl({
    fetch: fetchImpl,
    authorization: `tma ${initData}`,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  });
}

export const locationControlFingerprint = bondLocationControlFingerprint;
