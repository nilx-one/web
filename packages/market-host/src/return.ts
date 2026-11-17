// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type { CoreRuntimePort, CourierPlan } from "@nilx-one/application";
import type { EmbeddedMarketCatalogPort } from "@nilx-one/product-app/business";

import { readPaidItems, changePaidItem } from "./items";

const VISIT = "market_visit";
const ORDER = "market_order";
const TRIP = "nilx-one.market.trip";
const MANUAL_PENDING = "nilx-one.market.manual-pending";

/** Where Market sends the tab back to after a fulfilled order. */
export function marketReturnUrl(input: {
  returnPath: string;
  visitId: string;
  orderId: string;
}): string {
  // Market only accepts host pages such as `/` or `/telegram/`.
  const path = /^\/(?:[a-z0-9-]+\/)?$/.test(input.returnPath)
    ? input.returnPath
    : "/";
  const url = new URL(path, "https://nilx.one");
  url.searchParams.set(VISIT, input.visitId);
  url.searchParams.set(ORDER, input.orderId);
  return url.href;
}

interface Pending {
  readonly visitId: string;
  readonly orderId: string;
  /** When the tab came back from Market with this order. */
  readonly since: number;
}

interface TripRecord {
  readonly version: 1;
  readonly plan: CourierPlan;
  readonly pending?: Pending;
}

/** Core's Market return contract (`docs/xping-flyover.md` in core). */
export type MarketReturnCore = Pick<
  CoreRuntimePort,
  "marketReturnTrip" | "marketReturnPolicy"
> &
  Partial<Pick<CoreRuntimePort, "applyInventoryCommand">>;

/**
 * The 0x1 side of the return flight. The query names an order; only Identity's
 * completion check, tied to this Bond's visit and receipt, confirms it. Core
 * decides which kept route may be flown and how long an unconfirmed order is
 * asked about again; without Core nothing is flown or kept. The client never
 * confirms a purchase itself.
 */
export function createMarketReturn(
  authorization?: () => string | undefined,
  request: typeof fetch = fetch,
  core?: MarketReturnCore,
): NonNullable<EmbeddedMarketCatalogPort["confirmReturn"]> {
  return async () => {
    const url = new URL(location.href);
    const queried = url.searchParams.has(VISIT) || url.searchParams.has(ORDER);
    const visitId = url.searchParams.get(VISIT);
    const orderId = url.searchParams.get(ORDER);
    if (queried) {
      // A reload or shared link must not ask again for the same order.
      url.searchParams.delete(VISIT);
      url.searchParams.delete(ORDER);
      history.replaceState(
        history.state,
        "",
        url.pathname + url.search + url.hash,
      );
    }
    const policy = await readPolicy(core);
    const record = await readTrip(core, policy);
    const manualPending = record ? undefined : readManualPending(policy);
    let ask: Pending;
    if (queried) {
      if (
        visitId === null ||
        orderId === null ||
        !validReturn(visitId, orderId)
      )
        return { confirmed: false };
      ask = { visitId, orderId, since: Date.now() };
    } else if (record?.pending) {
      ask = record.pending;
    } else if (manualPending) {
      ask = manualPending;
    } else {
      return undefined;
    }

    // A manual visit retains only its opaque order/visit IDs for a bounded
    // retry; it never invents a courier route.
    if (!record && policy) writeManualPending(ask);
    const confirmed = await confirm(ask, authorization?.(), request);
    if (confirmed) {
      if (confirmed === "item") {
        if (record) writeTrip({ ...record, pending: ask });
        try {
          const items = await readPaidItems(authorization?.(), request);
          const item = items.find((item) => item.order_id === ask.orderId);
          if (!item || item.state === "stored") {
            removeTrip();
            removeManualPending();
            return { confirmed: true };
          }
          // Identity checks the same paid owner and original Market visit for
          // both xPing and self-collection. No browser assertion grants items.
          if (item.state === "paid")
            await changePaidItem(
              ask.orderId,
              { op: "collect", visit_id: ask.visitId },
              authorization?.(),
              request,
            );
          if (!record) {
            removeManualPending();
            // A walking Bond/Avaia has no xPing trip to return along.
            return { confirmed: true, itemId: ask.orderId };
          }
          return { confirmed: true, trip: record.plan, itemId: ask.orderId };
        } catch {
          return {
            confirmed: false,
            ...(policy ? { recheckMs: policy.recheckMs } : {}),
          };
        }
      }
      removeTrip();
      removeManualPending();
      return record
        ? { confirmed: true, trip: record.plan }
        : { confirmed: true };
    }
    const open =
      policy !== undefined && Date.now() - ask.since < policy.pendingMs;
    if (record) {
      writeTrip(
        open ? { ...record, pending: ask } : { version: 1, plan: record.plan },
      );
    } else if (open) {
      writeManualPending(ask);
    } else {
      removeManualPending();
    }
    return open && policy
      ? { confirmed, recheckMs: policy.recheckMs }
      : { confirmed };
  };
}

async function readPolicy(core: MarketReturnCore | undefined) {
  try {
    return await core?.marketReturnPolicy?.();
  } catch {
    return undefined;
  }
}

function validReturn(visitId: string, orderId: string): boolean {
  return (
    /^[\w-]{43}$/.test(visitId) && /^[A-Za-z0-9._:-]{1,128}$/.test(orderId)
  );
}

async function confirm(
  { visitId, orderId }: Pending,
  token: string | undefined,
  request: typeof fetch,
): Promise<boolean | "item"> {
  try {
    const response = await request(
      `/api/v1/identity/market-return?visit_id=${encodeURIComponent(visitId)}&order_id=${encodeURIComponent(orderId)}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/json",
          ...(token ? { authorization: token } : {}),
        },
      },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as {
      confirmed?: unknown;
      order_id?: unknown;
      item_delivery?: unknown;
    };
    return body.confirmed === true && body.order_id === orderId
      ? body.item_delivery === true
        ? "item"
        : true
      : false;
  } catch {
    return false;
  }
}

function isPending(
  value: unknown,
  policy: { pendingMs: number } | undefined,
): value is Pending {
  const { visitId, orderId, since } = (value ?? {}) as Record<string, unknown>;
  return (
    policy !== undefined &&
    typeof visitId === "string" &&
    typeof orderId === "string" &&
    validReturn(visitId, orderId) &&
    typeof since === "number" &&
    Number.isSafeInteger(since) &&
    since <= Date.now() &&
    Date.now() - since < policy.pendingMs
  );
}

/** The tab's route out to Market if Core says it may be flown; else none. */
function readManualPending(
  policy: { pendingMs: number } | undefined,
): Pending | undefined {
  try {
    const raw = sessionStorage.getItem(MANUAL_PENDING);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (isPending(parsed, policy)) return parsed;
  } catch {
    // Storage can be blocked. This never proves a collection.
  }
  removeManualPending();
  return undefined;
}

function writeManualPending(pending: Pending) {
  try {
    sessionStorage.setItem(MANUAL_PENDING, JSON.stringify(pending));
  } catch {
    // Identity still owns the order.
  }
}

function removeManualPending() {
  try {
    sessionStorage.removeItem(MANUAL_PENDING);
  } catch {
    // The server owns the paid-item lifecycle.
  }
}

/** The manual return keeps no flight; Core alone validates xPing routes. */
async function readTrip(
  core: MarketReturnCore | undefined,
  policy: { pendingMs: number } | undefined,
): Promise<TripRecord | undefined> {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(TRIP);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  let record: { version?: unknown; plan?: CourierPlan; pending?: unknown };
  try {
    record = JSON.parse(raw) as typeof record;
  } catch {
    removeTrip();
    return undefined;
  }
  const plan = record.version === 1 ? record.plan : undefined;
  let flyable: boolean | undefined;
  try {
    flyable = plan === undefined ? false : await core?.marketReturnTrip?.(plan);
  } catch {
    flyable = undefined;
  }
  // Without Core's answer the route is kept, but neither flown nor dropped.
  if (flyable === undefined) return undefined;
  if (!flyable || plan === undefined) {
    removeTrip();
    return undefined;
  }
  if (isPending(record.pending, policy))
    return { version: 1, plan, pending: record.pending };
  // A stale or broken order is let go; the route stays.
  if (record.pending !== undefined) writeTrip({ version: 1, plan });
  return { version: 1, plan };
}

function writeTrip(record: TripRecord) {
  try {
    sessionStorage.setItem(TRIP, JSON.stringify(record));
  } catch {
    // Without storage the order is simply not asked about again.
  }
}

function removeTrip() {
  try {
    sessionStorage.removeItem(TRIP);
  } catch {
    // Nothing was kept.
  }
}
