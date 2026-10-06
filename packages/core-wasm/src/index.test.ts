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
