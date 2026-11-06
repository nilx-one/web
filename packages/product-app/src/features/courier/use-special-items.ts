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
    window.addEventListener("focus", read);
    return () => {
      live = false;
      window.removeEventListener("focus", read);
    };
  }, [owner, catalog, returnId]);

  const change = useCallback(
    async function perform(id: string, delivery: boolean) {
      if (!catalog?.changeItem) return;
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
      } catch {
        setFailure(() => () => {
          void perform(id, delivery);
        });
      } finally {
        setBusy(false);
      }
    },
    [owner, catalog, refresh],
  );
  const activate = useCallback(
    (id: string) => {
      if (pending.current) return;
      pending.current = true;
      void change(id, false).finally(() => {
        pending.current = false;
      });
    },
    [change],
  );
  const arrive = useCallback(
    (id: string) => {
      void change(id, true);
    },
    [change],
  );
  return {
    items: snapshot?.owner === owner ? snapshot.items : [],
    busy,
    activate,
    arrive,
    retry: failure,
    dismissError: () => setFailure(undefined),
  };
}
