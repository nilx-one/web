// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  CoreRuntimePort,
  SubscriptionStatus,
  SubscriptionStatusPort,
} from "@nilx-one/application";
import "./subscription.css";

const UNKNOWN: SubscriptionStatus = { kind: "unknown" };
interface StatusContext {
  owner: string;
  avaia: string | undefined;
  status: SubscriptionStatus;
}
const Context = createContext<StatusContext>({
  owner: "",
  avaia: undefined,
  status: UNKNOWN,
});

/** One authority read + Core decision shared by every React/map surface. */
export function SubscriptionStatusProvider({
  owner,
  avaia,
  core,
  source,
  children,
}: {
  owner: string;
  avaia?: string | undefined;
  core: CoreRuntimePort;
  source?: SubscriptionStatusPort | undefined;
  children: ReactNode;
}) {
  const [result, setResult] = useState<{
    owner: string;
    source: SubscriptionStatusPort;
    core: CoreRuntimePort;
    status: SubscriptionStatus;
  }>();
  useEffect(() => {
    if (!source || !core.subscriptionStatus) return;
    let generation = 0;
    let stopped = false;
    let abort: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (stopped) return;
      const current = ++generation;
      abort?.abort();
      clearTimeout(timer);
      abort = new AbortController();
      // No stale privilege styling during refresh, logout or revocation.
      setResult({ owner, source, core, status: UNKNOWN });
      void source
        .read(owner, abort.signal)
        .then((snapshot) =>
          core.subscriptionStatus!(snapshot, owner, Date.now()),
        )
        .then((status) => {
          if (stopped || current !== generation) return;
          setResult({ owner, source, core, status });
          const delay =
            status.kind === "unknown"
              ? 30_000
              : Number(BigInt(status.valid_until_ms) - BigInt(Date.now()));
          timer = setTimeout(
            refresh,
            Math.min(2_147_483_647, Math.max(1, delay)),
          );
        })
        .catch(() => {
          if (stopped || current !== generation) return;
          setResult({ owner, source, core, status: UNKNOWN });
          timer = setTimeout(refresh, 30_000);
        });
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const unsubscribe = source.subscribe(owner, refresh);
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      generation += 1;
      abort?.abort();
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [owner, core, source]);
  const status =
    result?.owner === owner && result.source === source && result.core === core
      ? result.status
      : UNKNOWN;
  return (
    <Context.Provider value={{ owner, avaia, status }}>
      {children}
    </Context.Provider>
  );
}

export function useSubscriptionTier(address: string) {
  const { owner, avaia, status } = useContext(Context);
  if (
    status.kind !== "active" ||
    status.bond_pub_dress !== owner ||
    (address !== owner && address !== avaia)
  )
    return undefined;
  return status.tier;
}

/** Shared name treatment: never infer another person's tier from this owner. */
export function SubscriptionIdentity({
  address,
  badge = false,
}: {
  address: string;
  badge?: boolean;
}) {
  const tier = useSubscriptionTier(address);
  const { owner, avaia } = useContext(Context);
  const isSubject = address === owner || address === avaia;
  const name =
    tier === "exclusive"
      ? "Exclusive"
      : tier === "special"
        ? "Special"
        : undefined;
  return (
    <span
      key={address}
      className="subscription-identity"
      data-tier={tier}
      title={name}
    >
      {address}
      {badge && isSubject ? (
        <span className="subscription-badges" aria-hidden={tier === undefined}>
          <span
            className="subscription-badge"
            data-level="special"
            aria-hidden={tier !== "special"}
          >
            Special
          </span>
          <span
            className="subscription-badge"
            data-level="exclusive"
            aria-hidden={tier !== "exclusive"}
          >
            Exclusive
          </span>
        </span>
      ) : null}
    </span>
  );
}
