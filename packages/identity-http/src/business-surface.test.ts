// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";
import {
  createBusinessSurfaceHttp,
  parseBusinessSurface,
} from "./business-surface";
const label = "0xda-market";
const projection = {
  schemaVersion: 1,
  pubDress: label,
  publicUrl: `https://${label}.nilx.one`,
  displayName: label,
  contacts: [],
  directory: { kind: "unavailable" },
};
describe("business public HTTP boundary", () => {
  it("does not forward the visitor's session or cache public eligibility", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(projection)));
    const result = await createBusinessSurfaceHttp(
      fetcher as typeof fetch,
    ).read(label);
    expect(result.kind).toBe("ready");
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/identity/business?label=${label}`,
      { credentials: "omit", cache: "no-store" },
    );
  });
  it("fails closed on a different owner host, unsupported schema and malformed points", () => {
    expect(
      parseBusinessSurface(
        { ...projection, publicUrl: "https://another.nilx.one" },
        label,
      ),
    ).toBeUndefined();
    expect(
      parseBusinessSurface({ ...projection, schemaVersion: 2 }, label),
    ).toBeUndefined();
    expect(
      parseBusinessSurface(
        {
          ...projection,
          directory: { kind: "ready", cities: [], points: [{}] },
        },
        label,
      ),
    ).toBeUndefined();
  });
  it("keeps an actual empty directory separate from unavailable", () => {
    expect(
      parseBusinessSurface(
        { ...projection, directory: { kind: "ready", cities: [], points: [] } },
        label,
      )?.directory.kind,
    ).toBe("ready");
  });
  it("maps not found and upstream failure separately", async () => {
    expect(
      await createBusinessSurfaceHttp(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "public_bond_not_found" } }),
            { status: 404 },
          ),
      ).read(label),
    ).toEqual({ kind: "not-found" });
    expect(
      await createBusinessSurfaceHttp(
        async () => new Response(null, { status: 503 }),
      ).read(label),
    ).toEqual({ kind: "unavailable" });
  });
});
