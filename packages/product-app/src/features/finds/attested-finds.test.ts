// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AttestedFind,
  FindLocation,
} from "../progression/committed-journal";

let located: FindLocation[] = [];
let attested: AttestedFind[] = [];
let pickedUp = new Set<string>();
const spent: { id: string; reason: string }[] = [];
const unattestable: { artifactId: string; reason: string }[] = [];

vi.mock("../progression/committed-journal", () => ({
  readCommittedJournal: vi.fn(async () => ({
    finds: { located, attested },
    inventory: { state: "", pickedUp },
  })),
  subscribeCommittedJournal: vi.fn(() => () => undefined),
  noteFindAttested: vi.fn(async (_owner: string, find: AttestedFind) => {
    located = located.filter((one) => one.artifactId !== find.artifactId);
    attested = [...attested, find];
  }),
  noteFindUnattestable: vi.fn(
    async (_owner: string, artifactId: string, reason: string) => {
      located = located.filter((one) => one.artifactId !== artifactId);
      unattestable.push({ artifactId, reason });
    },
  ),
  noteFindSpent: vi.fn(async (_owner: string, id: string, reason: string) => {
    attested = attested.filter((one) => one.attestationId !== id);
    spent.push({ id, reason });
  }),
}));

const applyInventory = vi.fn(async () => ({
  ok: true as const,
  state: "",
  seedsGained: 0,
  seedsSpent: 0,
  experience: 0,
}));
vi.mock("../inventory/inventory", () => ({ applyInventory }));

const {
  attestKeptFinds,
  recipeInputs,
  sellAttested,
  startPaidCraft,
  PICKUP_MAX_AGE_MS,
} = await import("./attested-finds");

const NOW = 1_800_000_000_000;
const core = { applyInventoryCommand: vi.fn(), economyCatalog: vi.fn() };
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function port() {
  return {
    attestFind: vi.fn(),
    sellFind: vi.fn(),
    payCraft: vi.fn(),
  };
}

function find(artifactId: string, foundAtMs = NOW - 1_000): FindLocation {
  return {
    artifactId,
    finder: "bond",
    foundAtMs,
    longitude: 30.5,
    latitude: 50.4,
  };
}

beforeEach(() => {
  located = [];
  attested = [];
  pickedUp = new Set();
  spent.length = 0;
  unattestable.length = 0;
  applyInventory.mockClear();
});

describe("attestKeptFinds", () => {
  it("attests kept pick-ups, records refusals and gives up on stale ones", async () => {
    located = [
      find("art:a"),
      find("art:b"),
      find("art:c"),
      find("art:old", NOW - PICKUP_MAX_AGE_MS - 1),
    ];
    pickedUp = new Set(["art:a", "art:b"]);
    const identity = port();
    identity.attestFind
      .mockResolvedValueOnce({
        kind: "attested",
        attestationId: id(1),
        itemId: "small_change",
        seedsCredited: 15n,
      })
      .mockResolvedValueOnce({ kind: "refused", reason: "too_far" });

    const credited = await attestKeptFinds("0x0sky", identity, () => NOW);

    expect(credited).toBe(1);
    expect(identity.attestFind).toHaveBeenCalledTimes(2);
    expect(identity.attestFind).toHaveBeenCalledWith(find("art:a"));
    expect(attested).toEqual([
      { artifactId: "art:a", attestationId: id(1), itemId: "small_change" },
    ]);
    expect(unattestable).toEqual([
      { artifactId: "art:b", reason: "too_far" },
      { artifactId: "art:old", reason: "expired" },
    ]);
    // Not kept yet and still fresh: waits.
    expect(located.map((one) => one.artifactId)).toEqual(["art:c"]);
  });

  it("keeps a pick-up for later when Identity is unreachable", async () => {
    located = [find("art:a")];
    pickedUp = new Set(["art:a"]);
    const identity = port();
    identity.attestFind.mockResolvedValueOnce({ kind: "unavailable" });
    await attestKeptFinds("0x0sky", identity, () => NOW);
    expect(located).toHaveLength(1);
    expect(unattestable).toEqual([]);
  });
});

describe("sellAttested", () => {
  it("sells only an attested thing, by its id, then takes it out", async () => {
    const identity = port();
    expect(await sellAttested("0x0sky", identity, core, "bottle")).toEqual({
      kind: "unverified",
    });
    expect(identity.sellFind).not.toHaveBeenCalled();

    attested = [
      { artifactId: "art:a", attestationId: id(1), itemId: "bottle" },
    ];
    identity.sellFind.mockResolvedValueOnce({
      kind: "sold",
      seedsCredited: 5n,
    });
    expect(await sellAttested("0x0sky", identity, core, "bottle")).toEqual({
      kind: "sold",
      seeds: 5n,
    });
    expect(identity.sellFind).toHaveBeenCalledWith(id(1));
    expect(spent).toEqual([{ id: id(1), reason: "sold" }]);
    expect(applyInventory).toHaveBeenCalledWith("0x0sky", core, {
      op: "sell",
      id: "bottle",
      count: 1,
    });
  });

  it("keeps the thing when Identity is unreachable", async () => {
    attested = [
      { artifactId: "art:a", attestationId: id(1), itemId: "bottle" },
    ];
    const identity = port();
    identity.sellFind.mockResolvedValueOnce({ kind: "unavailable" });
    expect(await sellAttested("0x0sky", identity, core, "bottle")).toEqual({
      kind: "unavailable",
    });
    expect(spent).toEqual([]);
    expect(applyInventory).not.toHaveBeenCalled();
  });
});

describe("crafts paid through Identity", () => {
  const album = {
    id: "craft_album",
    consumes: [{ id: "scratched_cd", count: 3 }],
    tools: ["cd_player"],
    seeds: 0,
    makes: "album",
    experience: 75,
    place: "anywhere" as const,
    minutes: 45,
    legendary: false,
  };

  it("names one attested thing per input, or none at all", () => {
    const cds = [1, 2, 3].map((n) => ({
      artifactId: `art:${n}`,
      attestationId: id(n),
      itemId: "scratched_cd",
    }));
    expect(recipeInputs(cds.slice(0, 2), album)).toBeUndefined();
    expect(recipeInputs(cds, album)?.map((one) => one.attestationId)).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
  });

  it("pays, uses the inputs up, and starts Core's paid craft", async () => {
    const repair = {
      ...album,
      id: "repair_cd_player",
      consumes: [{ id: "broken_cd_player", count: 1 }],
      tools: [],
      seeds: 200,
      place: "repair_workshop" as const,
    };
    attested = [
      { artifactId: "art:a", attestationId: id(1), itemId: "broken_cd_player" },
    ];
    const identity = port();
    identity.payCraft.mockResolvedValueOnce({
      kind: "paid",
      seedsDebited: 200n,
    });
    const started = await startPaidCraft(
      "0x0sky",
      identity,
      core,
      repair,
      "repair_workshop",
      "craft-test-1",
    );
    expect(started).toEqual({ kind: "started", seeds: 200n });
    expect(identity.payCraft).toHaveBeenCalledWith(
      "craft-test-1",
      "repair_cd_player",
      [id(1)],
    );
    expect(spent).toEqual([{ id: id(1), reason: "crafted" }]);
    expect(applyInventory).toHaveBeenCalledWith("0x0sky", core, {
      op: "start_paid_craft",
      recipe: "repair_cd_player",
      place: "repair_workshop",
    });
  });

  it("starts nothing when Identity refuses", async () => {
    attested = [
      { artifactId: "art:a", attestationId: id(1), itemId: "scratched_cd" },
      { artifactId: "art:b", attestationId: id(2), itemId: "scratched_cd" },
      { artifactId: "art:c", attestationId: id(3), itemId: "scratched_cd" },
    ];
    const identity = port();
    identity.payCraft.mockResolvedValueOnce({
      kind: "refused",
      reason: "not_enough_seeds",
    });
    expect(
      await startPaidCraft("0x0sky", identity, core, album, "anywhere"),
    ).toEqual({ kind: "refused", reason: "not_enough_seeds" });
    expect(spent).toEqual([]);
    expect(applyInventory).not.toHaveBeenCalled();
  });
});
