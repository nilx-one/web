// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type { SeedsWalletAccessPort } from "@nilx-one/application";
import { useEffect, useState } from "react";

/** What the inventory shows as the Bond's seeds: Identity's wallet only. */
export type SeedsWalletView =
  | { readonly kind: "loading" }
  | { readonly kind: "read"; readonly balance: bigint }
  | { readonly kind: "unavailable" };

/**
 * Reads the authoritative Identity seeds wallet. It reads again whenever
 * `refreshKey` changes (for example when the inventory opens) and when the
 * page becomes visible again, so a Market purchase or xPing repair settled
 * elsewhere shows up. A failed read says so; it never falls back to the
 * browser inventory's amount.
 */
export function useSeedsWallet(
  wallet: SeedsWalletAccessPort | undefined,
  refreshKey?: unknown,
): SeedsWalletView | undefined {
  const [view, setView] = useState<SeedsWalletView>({ kind: "loading" });
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") setVisible((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (wallet === undefined) return;
    let live = true;
    void wallet
      .readSeedsWallet()
      .catch(() => ({ kind: "service-unavailable" }) as const)
      .then((read) => {
        if (!live) return;
        setView(
          read.kind === "read"
            ? { kind: "read", balance: read.balance }
            : { kind: "unavailable" },
        );
      });
    return () => {
      live = false;
    };
  }, [wallet, refreshKey, visible]);

  return wallet === undefined ? undefined : view;
}
