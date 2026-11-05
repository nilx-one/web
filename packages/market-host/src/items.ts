// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type {
  CoreInventoryAnswer,
  CoreInventoryCommand,
  SubscriptionStatusPort,
} from "@nilx-one/application";
import type { PaidSpecialItem } from "@nilx-one/product-app/business";

async function identity(
  path: string,
  token: string | undefined,
  request: typeof fetch,
  command?: unknown,
  signal?: AbortSignal,
) {
  const response = await request(`/api/v1/identity/${path}`, {
    method: command === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: signal ?? AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/json",
      ...(token ? { authorization: token } : {}),
      ...(command === undefined
        ? {}
        : { "content-type": "application/json", "x-0x1-csrf": "1" }),
    },
    ...(command === undefined ? {} : { body: JSON.stringify(command) }),
  });
  if (!response.ok) throw new Error("Identity request failed");
  return response.json();
}

export async function readPaidItems(
  token: string | undefined,
  request: typeof fetch,
): Promise<readonly PaidSpecialItem[]> {
  const body = (await identity("special-items", token, request)) as {
    items?: unknown;
  };
  if (
    !Array.isArray(body.items) ||
    !body.items.every(
      (item: PaidSpecialItem) =>
        item &&
        typeof item.order_id === "string" &&
        /^[A-Za-z0-9._:-]{8,128}$/.test(item.order_id) &&
        /^0x1_special_(1|3|6|12)m$/.test(item.sku) &&
        ["paid", "in_transit", "stored"].includes(item.state) &&
        (item.state === "stored"
          ? [item.slot_x, item.slot_y].every(
              (x) =>
                typeof x === "number" &&
                Number.isInteger(x) &&
                x >= 0 &&
                x < 255,
            )
          : item.slot_x === null && item.slot_y === null),
    )
  )
    throw new Error("Invalid paid inventory");
  return body.items as PaidSpecialItem[];
}

export async function changePaidItem(
  id: string,
  command: unknown,
  token: string | undefined,
  request: typeof fetch,
): Promise<void> {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(id)) throw new Error("Invalid item");
  const body = (await identity(
    `special-items/${encodeURIComponent(id)}`,
    token,
    request,
    command,
  )) as { ok?: unknown };
  if (body.ok !== true) throw new Error("Item action failed");
}

export async function inventoryCommand(
  state: string,
  command: CoreInventoryCommand,
  token: string | undefined,
  request: typeof fetch,
): Promise<CoreInventoryAnswer> {
  const answer = (await identity("special-inventory", token, request, {
    state,
    command,
  })) as CoreInventoryAnswer;
  if (answer.ok === false && typeof answer.error === "string") return answer;
  if (
    answer.ok !== true ||
    typeof answer.state !== "string" ||
    ![answer.seedsGained, answer.seedsSpent, answer.experience].every(
      (x) => Number.isSafeInteger(x) && x >= 0,
    )
  )
    throw new Error("Invalid inventory answer");
  return answer;
}

export function subscriptionSource(
  authorization: (() => string | undefined) | undefined,
  request: typeof fetch,
): SubscriptionStatusPort & { invalidate(): void } {
  const changes = new EventTarget();
  return {
    invalidate: () => changes.dispatchEvent(new Event("change")),
    async read(owner, signal) {
      const snapshot = await identity(
        "subscription",
        authorization?.(),
        request,
        undefined,
        signal,
      );
      return snapshot?.bond_pub_dress === owner ? snapshot : null;
    },
    subscribe(_owner, invalidate) {
      changes.addEventListener("change", invalidate);
      return () => changes.removeEventListener("change", invalidate);
    },
  };
}
