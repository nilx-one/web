// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PubInfoAccessPort } from "@nilx-one/application";
import { useEffect } from "react";

import { publishProgression, subscribeProgression } from "./progression";

/**
 * Keeps one Bond's activity experience in step with `pub_info`: offers what
 * this device has earned, and adopts what the service already holds.
 * A host that cannot publish simply does not pass a port.
 */
export function usePubInfoSync(
  owner: string,
  port: PubInfoAccessPort | undefined,
): void {
  useEffect(() => {
    if (port === undefined) return;
    let cancelled = false;
    let queued = false;
    const schedule = (): void => {
      if (cancelled || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (cancelled) return;
        void publishProgression(owner, port);
      });
    };
    schedule();
    const unsubscribe = subscribeProgression(schedule);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [owner, port]);
}
