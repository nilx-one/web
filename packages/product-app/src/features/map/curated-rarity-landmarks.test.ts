// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import { curatedLandmarkPins } from "./curated-rarity-landmarks";

const labels = [
  { id: "a", longitudeE7: "305000000", latitudeE7: "504500000", title: "Alpha", kind: "monument" },
  { id: "b", longitudeE7: "305100000", latitudeE7: "504510000", title: "Beta", kind: "sacred" },
  { id: "c", longitudeE7: "305200000", latitudeE7: "504520000", title: "Gamma", kind: "civic" },
] as const;

const view = JSON.stringify({
  ok: true,
  registry: 2,
  landmarks: [
    { id: "a", at: { longitude_e7: "305000000", latitude_e7: "504500000" }, rarity: "rare" },
    { id: "b", at: { longitude_e7: "305100000", latitude_e7: "504510000" }, rarity: "special" },
    { id: "c", at: { longitude_e7: "305200000", latitude_e7: "504520000" }, rarity: "exclusive" },
  ],
});

describe("Core curated landmark map projection", () => {
  it("renders ALL Rare/Special/Exclusive mapped subjects in stable identities", () => {
    const pins = curatedLandmarkPins(view, labels);
    expect(pins.map(({ id, rarity }) => [id, rarity])).toEqual([
      ["a", "rare"],
      ["b", "special"],
      ["c", "exclusive"],
    ]);
    expect(pins[1]?.latitude).toBe(50.451);
    expect(pins[2]?.weight).toBe(1);
  });

  it("does not accept a missing, displaced, duplicated or fake archive ID", () => {
    expect(() => curatedLandmarkPins(view, labels.slice(0, 2))).toThrow();
    expect(() =>
      curatedLandmarkPins(view, [{ ...labels[0], longitudeE7: "0" }, ...labels.slice(1)]),
    ).toThrow();
    expect(() => curatedLandmarkPins(view, [...labels, labels[0]])).toThrow();
    expect(() =>
      curatedLandmarkPins(view.replace('"id":"b"', '"id":"fake"'), labels),
    ).toThrow();
  });

  it("refuses unsupported/errored views rather than inventing rare pins", () => {
    expect(() =>
      curatedLandmarkPins('{"ok":false,"error":"invalid"}', labels),
    ).toThrow();
    expect(curatedLandmarkPins('{"ok":true,"registry":1,"landmarks":[]}', labels))
      .toEqual([]);
    expect(() => curatedLandmarkPins(view.replace('"rare"', '"common"'), labels))
      .toThrow();
  });
});
