// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import { deliverToInventory } from "../inventory/inventory";
import type { EmbeddedMarketCatalogPort, PaidSpecialItem } from "./market-dock";

export function useSpecialItems(
  owner: string,
  catalog: EmbeddedMarketCatalogPort | undefined,
  returnId: string | undefined,
) {
  const [snapshot, setSnapshot] = useState<{
    owner: string;
    items: readonly PaidSpecialItem[];
  }>();
  const [failure, setFailure] = useState<() => void>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (catalog?.items) setSnapshot({ owner, items: await catalog.items() });
  }, [owner, catalog]);
  useEffect(() => {
    let live = true;
    if (!catalog?.items) return;
    function read() {
      void catalog!.items!().then(
        (items) => {
          if (live) {
            setSnapshot({ owner, items });
            setFailure(undefined);
          }
        },
        () => {
          if (live) setFailure(() => read);
        },
      );
    }
    read();
    const whenVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    // TEST-bot payments can settle while the game remains open.
    // Poll only an active world tab; no client-side message proves payment.
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, 20_000);
    window.addEventListener("focus", read);
    window.addEventListener("online", read);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      live = false;
      window.clearInterval(poll);
      window.removeEventListener("focus", read);
      window.removeEventListener("online", read);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [owner, catalog, returnId]);

  /** Whether the change took: the caller asks the next question only then. */
  const change = useCallback(
    async function perform(id: string, delivery: boolean): Promise<boolean> {
      if (!catalog?.changeItem) return false;
      setBusy(true);
      try {
        if (delivery)
          await deliverToInventory(owner, async (grid) => {
            await catalog.changeItem!(id, {
              op: "deliver",
              carry: grid.carry,
              things: grid.things,
            });
            await refresh();
          });
        else {
          await catalog.changeItem(id, { op: "activate" });
          await refresh();
        }
        setFailure(undefined);
        return true;
      } catch {
        setFailure(() => () => {
          void perform(id, delivery);
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [owner, catalog, refresh],
  );
  const activate = useCallback(
    async (id: string): Promise<boolean> => {
      if (pending.current) return false;
      pending.current = true;
      try {
        return await change(id, false);
      } finally {
        pending.current = false;
      }
    },
    [change],
  );
  const arrive = useCallback((id: string) => change(id, true), [change]);
  return {
    items: snapshot?.owner === owner ? snapshot.items : [],
    busy,
    activate,
    arrive,
    retry: failure,
    dismissError: () => setFailure(undefined),
  };
}
