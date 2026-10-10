// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  CORE_CONTRACT_VERSION,
  CORE_FIXTURE_CORPUS_DIGEST,
  CORE_FIXTURE_CORPUS_VERSION,
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
  type GeneratedCoreWasmModule,
} from "./index";

function generatedRuntime(
  overrides: Partial<GeneratedCoreWasmModule> = {},
): GeneratedCoreWasmModule {
  return {
    default: vi.fn().mockResolvedValue({}),
    contract_version: () => CORE_CONTRACT_VERSION,
    fixture_corpus_version: () => CORE_FIXTURE_CORPUS_VERSION,
    fixture_corpus_digest: () => CORE_FIXTURE_CORPUS_DIGEST,
    derive_pub_dress_label: (value) =>
      value === "0x0небо" ? "label:xn--0x0-dddt1cj" : "error:not_a_pub_dress",
    compose_pub_dress_label: (value, suffix) =>
      value === "0x0небо" && suffix === "42"
        ? "label:xn--0x042-3ve3g4f"
        : "error:invalid_character",
    pub_dress_unicode_version: () => "16.0.0",
    pub_dress_uts46_implementation: () =>
      "idna=1.1.0;idna_adapter=1.1.0;idna_mapping=1.1.0",
    validate_pub_dress: (value) => (value === "0x0небо" ? "valid" : "invalid"),
    ...overrides,
  };
}

describe("CoreWasmClient", () => {
  it("reports the absent generated artifact", async () => {
    await expect(createCoreWasmClient().probe()).resolves.toEqual({
      kind: "unavailable",
      reason: "artifact-missing",
    });
  });

  it("reports a versioned generated binding", async () => {
    const client = createCoreWasmClient({
      loadBindings: async () => ({
        contractVersion: () => " fixture-contract ",
      }),
    });

    await expect(client.probe()).resolves.toEqual({
      kind: "ready",
      contractVersion: "fixture-contract",
    });
  });

  it("rejects an empty binding version", async () => {
    const client = createCoreWasmClient({
      loadBindings: async () => ({
        contractVersion: () => " ",
      }),
    });

    await expect(client.probe()).resolves.toEqual({
      kind: "unavailable",
      reason: "binding-invalid",
    });
  });

  it("accepts the generated runtime only after the full compatibility handshake", async () => {
    const runtime = generatedRuntime();
    const importRuntime = vi.fn(async () => runtime);
    const bindings = await loadGeneratedCoreWasmBindings({ importRuntime });

    expect(importRuntime).toHaveBeenCalledWith("/core/0.1.0/index.js");
    expect(runtime.default).toHaveBeenCalledWith({
      module_or_path: "/core/0.1.0/index_bg.wasm",
    });
    expect(bindings.contractVersion()).toBe("0.1.0");
    expect(bindings.derivePubDressLabel?.("0x0небо")).toEqual({
      kind: "label",
      label: "xn--0x0-dddt1cj",
    });
  });

  it("decodes stable Core label errors without reimplementing Unicode rules", async () => {
    const runtime = generatedRuntime({
      derive_pub_dress_label: () => "error:disallowed_scalar",
    });
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () => runtime,
    });

    expect(bindings.derivePubDressLabel?.("0x0a🌍")).toEqual({
      kind: "error",
      code: "disallowed_scalar",
    });
  });

  it("rejects malformed Core label wire results", async () => {
    const runtime = generatedRuntime({
      derive_pub_dress_label: () => "label:../unsafe",
    });
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () => runtime,
    });

    expect(() => bindings.derivePubDressLabel?.("0x0sky")).toThrow(
      "invalid PubDress label",
    );
  });

  it("names finds and reads the pick-up setting through Core", async () => {
    const runtime = generatedRuntime({
      find_item: (artifactId, tier) =>
        artifactId.startsWith("art:") && tier === 1
          ? "item:bottle_cap"
          : "error:artifact_id",
      backpack_gift_due: (state, level) =>
        state === "{" ? "error:invalid" : level >= 3 ? "yes" : "no",
      picks_up: (rarities, tier) =>
        rarities === "epic" ? "error:pickup_rarities" : tier < 4 ? "yes" : "no",
    });
    const client = createCoreWasmClient({
      loadBindings: () =>
        loadGeneratedCoreWasmBindings({ importRuntime: async () => runtime }),
    });

    await expect(client.findItem!("art:seg:1:2:e3:1:0", 1)).resolves.toEqual({
      kind: "item",
      id: "bottle_cap",
    });
    await expect(client.findItem!("nope", 1)).resolves.toEqual({
      kind: "error",
      code: "artifact_id",
    });
    await expect(client.picksUp!("common", 2)).resolves.toBe(true);
    await expect(client.backpackGiftDue!("", 3)).resolves.toBe(true);
    await expect(client.backpackGiftDue!("", 2)).resolves.toBe(false);
    await expect(client.backpackGiftDue!("{", 3)).rejects.toThrow("invalid");
    await expect(client.picksUp!("common", 5)).resolves.toBe(false);
    await expect(client.picksUp!("epic", 1)).rejects.toThrow("pickup_rarities");
  });

  it("rejects a malformed find item and an older runtime without one", async () => {
    const malformed = await loadGeneratedCoreWasmBindings({
      importRuntime: async () =>
        generatedRuntime({
          find_item: () => "item:../x",
          picks_up: () => "yes",
        }),
    });
    expect(() => malformed.findItem?.("art:x", 1)).toThrow("invalid find item");

    const older = createCoreWasmClient({
      loadBindings: () =>
        loadGeneratedCoreWasmBindings({
          importRuntime: async () => generatedRuntime(),
        }),
    });
    await expect(older.findItem!("art:x", 1)).rejects.toThrow("missing");
  });

  it("reads the economy catalog and refuses a malformed one", async () => {
    const catalog = {
      find_catalog_version: 1,
      economy_version: 1,
      currency: { code: "seed", emblem: "₴€£" },
      found: [
        {
          id: "cd_radio",
          tier: 5,
          rarity: "rare",
          experience: 25,
          seeds: "0",
          sell_price: "80",
          size: { width: 3, height: 2 },
        },
      ],
      crafted: [
        { id: "album", sell_price: "350", size: { width: 1, height: 1 } },
      ],
      recipes: [
        {
          id: "craft_album",
          consumes: [{ id: "scratched_cd", count: 3 }],
          tools: ["cd_player"],
          seeds: "0",
          makes: "album",
          experience: 75,
          place: "anywhere",
          minutes: 45,
          legendary: false,
        },
      ],
      carries: [{ id: "pocket", width: 5, height: 1, price: null }],
    };
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () =>
        generatedRuntime({ economy_catalog: () => JSON.stringify(catalog) }),
    });
    expect(bindings.economyCatalog?.()).toEqual({
      findCatalogVersion: 1,
      economyVersion: 1,
      currency: { code: "seed", emblem: "₴€£" },
      found: [
        {
          id: "cd_radio",
          tier: 5,
          rarity: "rare",
          experience: 25,
          seeds: 0,
          sellPrice: 80,
          size: { width: 3, height: 2 },
        },
      ],
      crafted: [{ id: "album", sellPrice: 350, size: { width: 1, height: 1 } }],
      recipes: [
        {
          id: "craft_album",
          consumes: [{ id: "scratched_cd", count: 3 }],
          tools: ["cd_player"],
          seeds: 0,
          makes: "album",
          experience: 75,
          place: "anywhere",
          minutes: 45,
          legendary: false,
        },
      ],
      carries: [{ id: "pocket", width: 5, height: 1, price: null }],
    });

    const malformed = await loadGeneratedCoreWasmBindings({
      importRuntime: async () =>
        generatedRuntime({
          economy_catalog: () =>
            JSON.stringify({
              ...catalog,
              found: [{ ...catalog.found[0], rarity: "epic" }],
            }),
        }),
    });
    expect(() => malformed.economyCatalog?.()).toThrow("invalid catalog item");
  });

  it("applies inventory commands through Core and keeps its state opaque", async () => {
    const seen: string[] = [];
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () =>
        generatedRuntime({
          apply_inventory_command: (state, command, now) => {
            seen.push(`${state}|${command}|${now}`);
            return command.includes("sell")
              ? JSON.stringify({ ok: false, error: "missing" })
              : JSON.stringify({
                  ok: true,
                  item: "bottle_cap",
                  state: { seeds: "0" },
                  outcome: {
                    seeds_gained: "0",
                    seeds_spent: "0",
                    experience: 0,
                  },
                });
          },
        }),
    });

    expect(
      bindings.applyInventoryCommand?.(
        "",
        { op: "pick_up", holder: "bond", artifact_id: "art:x", tier: 1 },
        1_000,
      ),
    ).toEqual({
      ok: true,
      state: '{"seeds":"0"}',
      seedsGained: 0,
      seedsSpent: 0,
      experience: 0,
      item: "bottle_cap",
    });
    expect(
      bindings.applyInventoryCommand?.(
        '{"seeds":"0"}',
        { op: "sell", id: "can", count: 1 },
        1_000,
      ),
    ).toEqual({ ok: false, error: "missing" });
    expect(seen[0]).toBe(
      '|{"op":"pick_up","holder":"bond","artifact_id":"art:x","tier":1}|1000',
    );
    expect(() =>
      bindings.applyInventoryCommand?.("", { op: "finish_craft" }, 1.5),
    ).toThrow(RangeError);
  });

  it("steps the Avaia's drive through Core and reads its commands strictly", async () => {
    // Answers as Core's drive gives them (docs/avaia-drive.md in core).
    const tap =
      '{"commands":[{"do":"walk","grass":true,"purpose":"tap","to":"b:1"},{"do":"say","line":"walk"}],"ok":true,"state":{"version":1}}';
    const choose =
      '{"commands":[{"default":1,"do":"choose","heading":"tap","menu":[{"action":"carry_on","index":0},{"action":"glance","index":1,"kind":"monument","reach":"near"}],"what":"distraction"},{"do":"wake_at","ms":"6001"}],"ok":true,"state":{"version":1}}';
    const seen: string[] = [];
    let answer = tap;
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () =>
        generatedRuntime({
          avaia_drive_step: (state, input, now, hour) => {
            seen.push(`${state}|${input}|${now}|${hour}`);
            return answer;
          },
        }),
    });

    expect(
      bindings.avaiaDriveStep?.("", { type: "tap", to: "b:1" }, 1_000, 13),
    ).toEqual({
      ok: true,
      state: '{"version":1}',
      commands: [
        { do: "walk", grass: true, purpose: "tap", to: "b:1" },
        { do: "say", line: "walk" },
      ],
    });
    expect(seen[0]).toBe('|{"type":"tap","to":"b:1"}|1000|13');

    answer = choose;
    const chosen = bindings.avaiaDriveStep?.("{}", { type: "tick" }, 2_001, 13);
    expect(chosen?.ok && chosen.commands).toEqual([
      {
        default: 1,
        do: "choose",
        heading: "tap",
        menu: [
          { action: "carry_on", index: 0 },
          { action: "glance", index: 1, kind: "monument", reach: "near" },
        ],
        what: "distraction",
      },
      { do: "wake_at", ms: 6_001 },
    ]);

    // Curiosity's menu: stay, or go and study a landmark from the notebook.
    answer =
      '{"commands":[{"default":1,"do":"choose","menu":[{"action":"stay","index":0},{"action":"study","index":1,"kind":"monument","reach":"near","feeling":"new"}],"what":"curiosity"}],"ok":true,"state":{"version":1}}';
    const curious = bindings.avaiaDriveStep?.(
      "{}",
      {
        type: "curiosity_options",
        to: [{ ref: "l:1", kind: "monument", meters: 400, feeling: "new" }],
      },
      2_002,
      13,
    );
    expect(curious?.ok && curious.commands[0]).toMatchObject({
      do: "choose",
      what: "curiosity",
      default: 1,
    });

    answer = '{"error":"invalid","ok":false}';
    expect(bindings.avaiaDriveStep?.("{", { type: "tick" }, 1, 13)).toEqual({
      ok: false,
      error: "invalid",
    });

    // A command the host cannot read stops the whole answer.
    for (const bad of [
      '{"ok":true,"state":{},"commands":[{"do":"teleport"}]}',
      '{"ok":true,"state":{},"commands":[{"do":"walk","to":"","purpose":"tap","grass":true}]}',
      '{"ok":true,"state":{},"commands":[{"do":"say","line":"anything"}]}',
      '{"ok":true,"state":{},"commands":[{"do":"choose","what":"outing","menu":[{"index":1,"action":"stay"}],"default":0}]}',
      '{"ok":true,"state":{},"commands":[{"do":"choose","what":"outing","menu":[{"index":0,"action":"go","kind":"Say 7"}],"default":0}]}',
      '{"ok":true,"state":{},"commands":[{"do":"look","ms":20000}]}',
    ]) {
      answer = bad;
      expect(() =>
        bindings.avaiaDriveStep?.("", { type: "tick" }, 1, 13),
      ).toThrow();
    }
    expect(() =>
      bindings.avaiaDriveStep?.("", { type: "tick" }, 1, 24),
    ).toThrow(RangeError);
  });

  it("reads Avaia life's needs and home through Core", async () => {
    // Answers as Core's life gives them (docs/avaia-life.md in core).
    const walked =
      '{"ok":true,"state":{"activity":"walking","energy":"9820","home":{"latitude_e7":"504501000","longitude_e7":"305234000"},"hunger":"60","intent":"explore","owner":"0x0sky","position":{"latitude_e7":"504501000","longitude_e7":"305234000"},"remainder_ms":"0","subject":"x0skai","version":"1"}}';
    const seen: string[] = [];
    let answer = walked;
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () =>
        generatedRuntime({
          apply_avaia_life: (state, owner, subject, command) => {
            seen.push(`${state}|${owner}|${subject}|${command}`);
            return answer;
          },
        }),
    });
    const position = { longitude_e7: "305234000", latitude_e7: "504501000" };
    const read = bindings.applyAvaiaLife?.("{}", "0x0sky", "x0skai", {
      op: "observe",
      elapsed_ms: "60000",
      position,
      motion: "walking",
    });
    expect(read).toMatchObject({
      ok: true,
      intent: "explore",
      energy: 9_820,
      hunger: 60,
      home: { longitude: 30.5234, latitude: 50.4501 },
    });
    expect(seen[0]).toBe(
      '{}|0x0sky|x0skai|{"op":"observe","elapsed_ms":"60000","position":{"longitude_e7":"305234000","latitude_e7":"504501000"},"motion":"walking"}',
    );
    answer = '{"error":"invalid_command","ok":false}';
    expect(
      bindings.applyAvaiaLife?.("", "0x0sky", "x0skai", {
        op: "initialize",
        home: position,
        position,
      }),
    ).toEqual({ ok: false, error: "invalid_command" });
    answer = walked.replace('"intent":"explore"', '"intent":"fly"');
    expect(() =>
      bindings.applyAvaiaLife?.("", "0x0sky", "x0skai", {
        op: "initialize",
        home: position,
        position,
      }),
    ).toThrow();
  });

  it("hands the previous blocked bit to Core's proximity policy and decodes strictly", async () => {
    // Answers as Core's avaia_proximity gives them (docs/avaia-proximity.md).
    const wire = (over: Record<string, unknown> = {}): string =>
      JSON.stringify({
        distance_m: 4_600,
        red_m: 5_000,
        restore_below_m: 4_500,
        level: "restricted",
        can_reveal: true,
        duration_ms: 600_000,
        ...over,
      });
    const seen: string[] = [];
    let answer = wire();
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () =>
        generatedRuntime({
          avaia_proximity: (distance, artifacts, blocked) => {
            seen.push(`${distance}|${artifacts}|${blocked}`);
            return answer;
          },
        }),
    });
    expect(bindings.avaiaProximity?.(4_600, 5, false)).toMatchObject({
      can_reveal: true,
      level: "restricted",
    });
    expect(seen).toEqual(["4600|5|false"]);
    answer = wire({ can_reveal: false, duration_ms: null });
    expect(bindings.avaiaProximity?.(4_600, 5, true)?.can_reveal).toBe(false);
    expect(seen[1]).toBe("4600|5|true");

    const refused: Record<string, unknown>[] = [
      { level: "fly" },
      { level: "near" }, // inside the restore band
      { level: "red" }, // red is not below the red line
      { distance_m: 5_000, level: "restricted" },
      { distance_m: 5_000, level: "red" }, // red can never reveal
      {
        distance_m: 100,
        level: "working",
        can_reveal: false,
        duration_ms: null,
      },
      { distance_m: 100, level: "red" },
      { can_reveal: true, duration_ms: null },
      { can_reveal: false, duration_ms: 60_000 },
      { duration_ms: 59_999 },
      { duration_ms: 600_001 },
      { duration_ms: 90_000.5 },
      { distance_m: -1 },
      { distance_m: 4_600.5 },
      { restore_below_m: 5_000 },
      { red_m: 0 },
    ];
    for (const change of refused) {
      answer = wire(change);
      expect(
        () => bindings.avaiaProximity?.(4_600, 0, false),
        wire(change),
      ).toThrow();
    }
    // An empty answer (Core's refusal to serialize) authorizes nothing either.
    answer = "";
    expect(() => bindings.avaiaProximity?.(1, 0, false)).toThrow();
    // Inputs outside what a u32 and a boolean can carry never reach Core.
    for (const bad of [-1, 1.5, 0x1_0000_0000, Number.NaN]) {
      expect(() => bindings.avaiaProximity?.(bad, 0, false)).toThrow(
        RangeError,
      );
      expect(() => bindings.avaiaProximity?.(1, bad, false)).toThrow(
        RangeError,
      );
    }
  });

  it("hands the orb world to Core as its wire and decodes the answer strictly", async () => {
    const at = { longitude_e7: "304469000", latitude_e7: "504655000" };
    const view = {
      orbs: [
        { id: "orb:art:seg:1:2:e3:1:0:0", kind: "orb", at, lands_at: "1070" },
      ],
      bond_reach: [],
      avaia_reach: ["orb:art:seg:1:2:e3:1:0:0"],
      next_expiry: "1801000",
    };
    const seen: string[] = [];
    let answer = JSON.stringify({ ok: true, view });
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () =>
        generatedRuntime({
          orb_world: (world, now) => {
            seen.push(`${world}|${now}`);
            return answer;
          },
        }),
    });
    const world = { spills: [], picked: [], bond: null, avaia: at };
    expect(bindings.orbWorld?.(world, 1_000)).toEqual(view);
    expect(seen).toEqual([`${JSON.stringify(world)}|1000`]);

    for (const bad of [
      { ok: false, error: "invalid" },
      { ok: true, view: { ...view, next_expiry: 5 } },
      { ok: true, view: { ...view, avaia_reach: ["art:1"] } },
      {
        ok: true,
        view: { ...view, orbs: [{ ...view.orbs[0], kind: "rock" }] },
      },
      {
        ok: true,
        view: { ...view, orbs: [{ ...view.orbs[0], lands_at: 1070 }] },
      },
    ]) {
      answer = JSON.stringify(bad);
      expect(() => bindings.orbWorld?.(world, 1_000)).toThrow();
    }
    expect(() => bindings.orbWorld?.(world, -1)).toThrow(RangeError);
  });

  it("has no proximity on a runtime built before it", async () => {
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () => generatedRuntime(),
    });
    expect(bindings.avaiaProximity).toBeUndefined();
    await expect(
      createCoreWasmClient({
        loadBindings: async () => bindings,
      }).avaiaProximity?.(1, 0, true),
    ).rejects.toThrow("proximity binding is missing");
  });

  it("has no drive on a runtime built before it", async () => {
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () => generatedRuntime(),
    });
    expect(bindings.avaiaDriveStep).toBeUndefined();
    await expect(
      createCoreWasmClient({
        loadBindings: async () => bindings,
      }).avaiaDriveStep?.("", { type: "tick" }, 1, 13),
    ).rejects.toThrow("drive binding is missing");
  });

  it("rejects a generated runtime with a different corpus digest", async () => {
    const runtime = generatedRuntime({
      fixture_corpus_digest: () => "sha256_wrong",
    });

    await expect(
      loadGeneratedCoreWasmBindings({ importRuntime: async () => runtime }),
    ).rejects.toThrow("compatibility verification");
  });

  it("loads the generated runtime from a host-proxied base", async () => {
    const runtime = generatedRuntime();
    const importRuntime = vi.fn(async () => runtime);

    await loadGeneratedCoreWasmBindings({
      baseUrl: "/.proxy/core/0.1.0",
      importRuntime,
    });

    expect(importRuntime).toHaveBeenCalledWith("/.proxy/core/0.1.0/index.js");
    expect(runtime.default).toHaveBeenCalledWith({
      module_or_path: "/.proxy/core/0.1.0/index_bg.wasm",
    });
  });
});
