// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STATE_PLACEMENT, placedStateForKey } from "@nilx-one/application";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Where browser state is written: every package and every host entry point. */
const CLIENT_ROOTS = ["packages", "apps"] as const;

/** Where a device-only or synchronizable record must never be read from. */
const EGRESS_ROOTS = [
  "packages/identity-http/src",
  "services/identity/src",
] as const;

/** A browser storage key or key prefix, as it appears in source and prose. */
const STORAGE_KEY = /nilx-one\.[A-Za-z0-9][A-Za-z0-9.-]*/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === "node_modules" || entry === "dist") return [];

    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);

    return /\.(?:tsx?|rs|html)$/.test(entry) && !/\.test\.tsx?$/.test(entry)
      ? [path]
      : [];
  });
}

function clientSources(): string[] {
  return CLIENT_ROOTS.flatMap((root) =>
    readdirSync(join(ROOT, root)).flatMap((name) => {
      const src = join(ROOT, root, name, "src");
      const files = statSync(src, { throwIfNoEntry: false })?.isDirectory()
        ? sourceFiles(src)
        : [];
      const html = join(ROOT, root, name, "index.html");
      return statSync(html, { throwIfNoEntry: false })?.isFile()
        ? [...files, html]
        : files;
    }),
  );
}

/** Keys as source spells them, with an owner placeholder or trailing separator removed. */
function storageKeys(source: string): string[] {
  return [...source.matchAll(STORAGE_KEY)].map((match) =>
    match[0].replace(/[.:-]+$/, ""),
  );
}

describe("State placement contract", () => {
  const files = clientSources();

  it("places every browser storage key the client writes", () => {
    const unplaced = new Set<string>();

    for (const file of files) {
      for (const key of storageKeys(readFileSync(file, "utf8"))) {
        if (placedStateForKey(key) === undefined) {
          unplaced.add(`${key} (${relative(ROOT, file)})`);
        }
      }
    }

    expect([...unplaced]).toEqual([]);
  });

  it("names no browser storage key the client no longer writes", () => {
    const written = new Set(
      files.flatMap((file) => storageKeys(readFileSync(file, "utf8"))),
    );
    const stale = STATE_PLACEMENT.filter(
      (record) => record.medium === "local-storage" && !written.has(record.key),
    ).map((record) => record.key);

    expect(stale).toEqual([]);
  });

  it("keeps the presence journal where the manifest says it is", () => {
    const presence = sourceFiles(join(ROOT, "packages/presence-idb/src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const stores = STATE_PLACEMENT.filter(
      (record) => record.medium === "indexed-db",
    ).map((record) => record.key.split("/"));

    expect(stores.length).toBeGreaterThan(0);
    for (const [database, store] of stores) {
      expect(presence).toContain(`"${database}"`);
      expect(presence).toContain(`"${store}"`);
    }
  });

  it("gives the network no device-only or synchronizable key to read", () => {
    const local = STATE_PLACEMENT.filter(
      (record) => record.medium !== "identity-service",
    );
    const violations: string[] = [];

    for (const root of EGRESS_ROOTS) {
      for (const file of sourceFiles(join(ROOT, root))) {
        const source = readFileSync(file, "utf8");
        for (const record of local) {
          if (source.includes(record.key)) {
            violations.push(`${relative(ROOT, file)} reads ${record.key}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps server placement to what a sign-in and a body need", () => {
    const server = STATE_PLACEMENT.filter(
      (record) => record.placement === "server",
    );
    for (const record of server) {
      expect(
        /^identity\.|^avatar\./.test(record.id),
        `${record.id} is not identity or body state`,
      ).toBe(true);
    }
  });
});
