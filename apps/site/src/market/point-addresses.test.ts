// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { expect, it, vi } from "vitest";
import {
  readMarketPointAddresses,
  resolveMarketPointPath,
} from "./point-addresses";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

it("reads the registry without credentials and drops malformed entries", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    json({
      points: [
        { address: "zoloti", station_pub_dress: "0xda-market-zoloti-vorota" },
        { address: "Zoloti", station_pub_dress: "0xda-market-zoloti-vorota" },
        { address: "x", station_pub_dress: "elsewhere-zoloti" },
        { address: "y" },
      ],
    }),
  );
  await expect(readMarketPointAddresses(request)).resolves.toEqual([
    { address: "zoloti", station: "0xda-market-zoloti-vorota" },
  ]);
  expect(request).toHaveBeenCalledWith(
    "/nilx-browser/points",
    expect.objectContaining({ credentials: "omit", redirect: "error" }),
  );
  await expect(
    readMarketPointAddresses(vi.fn<typeof fetch>().mockResolvedValue(json({}))),
  ).rejects.toThrow();
  await expect(
    readMarketPointAddresses(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("", { status: 503 })),
    ),
  ).rejects.toThrow();
});

it("resolves an older link to its canonical address", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    json({
      point: {
        address: "zoloti",
        station_pub_dress: "0xda-market-zoloti-vorota",
        canonical: false,
      },
    }),
  );
  await expect(resolveMarketPointPath("золоті", request)).resolves.toEqual({
    address: "zoloti",
    station: "0xda-market-zoloti-vorota",
    canonical: false,
  });
  expect(request.mock.calls[0]?.[0]).toBe(
    "/nilx-browser/points/%D0%B7%D0%BE%D0%BB%D0%BE%D1%82%D1%96",
  );
  await expect(
    resolveMarketPointPath(
      "nowhere",
      vi.fn<typeof fetch>().mockResolvedValue(json({}, 404)),
    ),
  ).resolves.toBeNull();
  await expect(
    resolveMarketPointPath(
      "zoloti",
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          point: { address: "zoloti", station_pub_dress: "0xda-market-z" },
        }),
      ),
    ),
  ).rejects.toThrow();
});
