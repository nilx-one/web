// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type { EmbeddedMarketCatalogPort } from "@nilx-one/product-app/business";

export const beginMarketVisit: NonNullable<
  EmbeddedMarketCatalogPort["beginVisit"]
> = async (input) => {
  // The optional return-trip hint is not required to authenticate at Market.
  // Blocked storage must not prevent an otherwise valid server handoff.
  try {
    sessionStorage.setItem(
      "nilx-one.market.trip",
      JSON.stringify({ version: 1, plan: input.plan }),
    );
  } catch {
    // This tab can still browse Market; return-flight integration is separate.
  }
  const controller = new AbortController();
  const onCancel = () => controller.abort();
  input.signal?.addEventListener("abort", onCancel, { once: true });
  const timeout = setTimeout(onCancel, 15_000);
  try {
    if (input.signal?.aborted) throw new Error("Market visit cancelled");
    const response = await fetch("/api/v1/identity/market-visit", {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: { "Content-Type": "application/json", "x-0x1-csrf": "1" },
      signal: controller.signal,
      body: JSON.stringify({
        point: input.point,
        // No currency originates in the browser. Identity reads its wallet
        // before issuing the Market handoff.
        avaia: input.avaia,
      }),
    });
    if (!response.ok) throw new Error("Market handoff unavailable");
    const body = (await response.json()) as { code?: unknown };
    if (typeof body.code !== "string" || !/^[\w-]{43}$/.test(body.code))
      throw new Error("Invalid handoff");
    // Do not navigate after a changed selection cancels the old request.
    if (controller.signal.aborted) throw new Error("Market visit cancelled");
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
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onCancel);
  }
};
