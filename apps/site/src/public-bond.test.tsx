// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  PublicBondPage,
  isPublicBondHostname,
  readPublicBond,
} from "./public-bond";

describe("public Bond host routing", () => {
  it("recognizes only the Bond namespace below nilx.one", () => {
    expect(isPublicBondHostname("0x0sky.nilx.one")).toBe(true);
    expect(isPublicBondHostname("xn--0x0-dddt1cj.nilx.one")).toBe(true);
    expect(isPublicBondHostname("XN--0X0-DDDT1CJ.NILX.ONE.")).toBe(true);

    expect(isPublicBondHostname("nilx.one")).toBe(false);
    expect(isPublicBondHostname("www.nilx.one")).toBe(false);
    expect(isPublicBondHostname("api.nilx.one")).toBe(false);
    expect(isPublicBondHostname("0x0sky.preview.nilx.one")).toBe(false);
    expect(isPublicBondHostname("0x0sky.example.com")).toBe(false);
  });

  it("keeps the readable Unicode address returned by stored allocation", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          pub_dress: "0x0небо",
          pub_dress_url: "https://0x0небо.nilx.one",
          avaia_pub_dress: "0небai",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    await expect(readPublicBond(fetchImpl)).resolves.toEqual({
      kind: "ready",
      bond: {
        pubDress: "0x0небо",
        pubDressUrl: "https://0x0небо.nilx.one",
        avaiaPubDress: "0небai",
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/identity/public", {
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("renders the pub_dress rather than the DNS transport label", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          pub_dress: "0x0небо",
          pub_dress_url: "https://0x0небо.nilx.one",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    render(<PublicBondPage fetchImpl={fetchImpl} />);

    expect(
      await screen.findByRole("heading", { name: "0x0небо" }),
    ).toBeVisible();
    expect(screen.getByText("0x0небо.nilx.one")).toBeVisible();
    expect(
      screen.queryByText("xn--0x0-dddt1cj.nilx.one"),
    ).not.toBeInTheDocument();
  });

  it("does not invent a Bond for an unallocated label", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;

    render(<PublicBondPage fetchImpl={fetchImpl} />);

    expect(
      await screen.findByRole("heading", { name: "Bond not found." }),
    ).toBeVisible();
  });
});
