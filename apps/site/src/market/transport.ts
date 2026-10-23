// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** Public catalog only. This host has no checkout or payment authority. */
export function catalogTransport(request: typeof fetch = fetch) {
  const unavailable = async (): Promise<never> => {
    throw new Error("Checkout is not connected in this host");
  };
  return {
    async bootstrap({ locale }: { locale: string }): Promise<unknown> {
      const response = await request(
        `/market-api/bootstrap?locale=${encodeURIComponent(locale)}`,
        {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) throw new Error("Catalog unavailable");
      return response.json();
    },
    quote: unavailable,
    acceptQuote: unavailable,
    refreshOrder: unavailable,
  };
}
