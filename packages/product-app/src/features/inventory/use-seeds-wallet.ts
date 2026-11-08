// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type {
  SeedsWalletAccessPort,
  SeedsWalletResult,
} from "@nilx-one/application";
import { useEffect, useState } from "react";

/** What the inventory shows as the Bond's seeds: Identity's wallet only. */
export type SeedsWalletView =
  | { readonly kind: "loading" }
  | { readonly kind: "read"; readonly balance: bigint }
  | { readonly kind: "unavailable" };

const LOADING: SeedsWalletView = { kind: "loading" };

/** A read is shown only for the Bond and wallet port that asked for it. */
interface OwnedView {
  readonly owner: string;
  readonly wallet: SeedsWalletAccessPort;
  readonly view: SeedsWalletView;
}

/**
 * Reads the authoritative Identity seeds wallet of `owner`. It reads again
 * whenever `refreshKey` changes (the inventory opening, a confirmed xPing
 * repair) and when the page becomes visible again, so a Market purchase
 * settled elsewhere shows up. A failed read says so; it never falls back to
 * the browser inventory's amount.
 *
 * The answer is bound to the Bond and port that asked: when either changes
 * (sign-out, another Bond, a new session's port) the view is `loading` in the
 * same render, and a late answer for the previous one is dropped, so one
 * Bond's balance is never shown for another.
 */
export function useSeedsWallet(
  owner: string,
  wallet: SeedsWalletAccessPort | undefined,
  refreshKey?: unknown,
): SeedsWalletView | undefined {
  const [latest, setLatest] = useState<OwnedView | undefined>();
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
      .catch((): SeedsWalletResult => ({ kind: "service-unavailable" }))
      .then((read) => {
        if (!live) return;
        setLatest({
          owner,
          wallet,
          view:
            read.kind === "read"
              ? { kind: "read", balance: read.balance }
              : { kind: "unavailable" },
        });
      });
    return () => {
      live = false;
    };
  }, [owner, wallet, refreshKey, visible]);

  if (wallet === undefined) return undefined;
  return latest?.owner === owner && latest.wallet === wallet
    ? latest.view
    : LOADING;
}
