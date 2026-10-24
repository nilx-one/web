// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type { EmbeddedMarketCatalogPort } from "@nilx-one/product-app/business";

export const beginMarketVisit: NonNullable<
  EmbeddedMarketCatalogPort["beginVisit"]
> = async (input) => {
  // Survives leaving this origin, so the return journey can resume the same trip.
  sessionStorage.setItem(
    "nilx-one.market.trip",
    JSON.stringify({ version: 1, plan: input.plan }),
  );
  const response = await fetch("/api/v1/identity/market-visit", {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    headers: { "Content-Type": "application/json", "x-0x1-csrf": "1" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      point: input.point,
      seeds: input.seeds,
      avaia: input.avaia,
    }),
  });
  if (!response.ok) throw new Error("Market handoff unavailable");
  const body = (await response.json()) as { code?: unknown };
  if (typeof body.code !== "string" || !/^[\w-]{43}$/.test(body.code))
    throw new Error("Invalid handoff");
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://0xda-market.nilx.one/nilx-browser/exchange";
  const code = document.createElement("input");
  code.type = "hidden";
  code.name = "code";
  code.value = body.code;
  form.append(code);
  document.body.append(form);
  form.submit();
};
