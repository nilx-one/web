// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  STATE_PLACEMENT,
  mobilityAgreesWithPlacement,
  placedStateForKey,
  placementAgreesWithMedium,
} from "@nilx-one/application";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Where browser state is written: every package and every host entry point. */
const CLIENT_ROOTS = ["packages", "apps"] as const;

/** Where a device-only or transport-eligible record must never be read from. */
const EGRESS_ROOTS = [
  "packages/identity-http/src",
  "services/identity/src",
] as const;

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

/**
 * Drops comments while keeping string and template literals, so a key
 * mentioned in prose is not mistaken for a write.
 */
export function withoutComments(source: string): string {
  let out = "";
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      out += " ";
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }

    const quote = source[index];
    if (quote === '"' || quote === "'" || quote === "`") {
      out += quote;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          out += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        out += source[index];
        index += 1;
      }
      out += source[index] ?? "";
      index += 1;
      continue;
    }

    out += source[index];
    index += 1;
  }

  return out;
}

function stringConstants(source: string): Map<string, string> {
  const bound = new Map<string, string>();
  for (const match of source.matchAll(
    /(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*["'](nilx-one\.[^"']+)["']/g,
  )) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) bound.set(name, value);
  }
  return bound;
}

/** The text of one brace-delimited body. Strings, including templates, are opaque. */
function readBlock(source: string, from: number): string {
  let depth = 1;
  let index = from;
  let out = "";

  while (index < source.length && depth > 0) {
    const quote = source[index];
    if (quote === '"' || quote === "'" || quote === "`") {
      out += quote;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          out += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        out += source[index];
        index += 1;
      }
      out += source[index] ?? "";
      index += 1;
      continue;
    }

    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    out += source[index];
    index += 1;
  }

  return out;
}

function returnedExpressions(source: string): Map<string, string> {
  const returned = new Map<string, string>();
  for (const match of source.matchAll(
    /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)[^{]*\{/g,
  )) {
    const name = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const expression = readBlock(source, start)
      .match(/return\s+([^;]+);/)?.[1]
      ?.trim();
    if (name !== undefined && expression !== undefined) {
      returned.set(name, expression);
    }
  }
  return returned;
}

function resolveKey(
  expression: string,
  constants: ReadonlyMap<string, string>,
  functions: ReadonlyMap<string, string>,
): string | undefined {
  const trimmed = expression.trim();
  const literal = trimmed.match(/^["'](nilx-one\.[^"']+)["']$/);
  if (literal?.[1] !== undefined) return literal[1];

  const name = trimmed.match(/^([A-Za-z0-9_]+)$/)?.[1];
  if (name !== undefined && constants.has(name)) return constants.get(name);

  const concatenated = trimmed.match(/^([A-Za-z0-9_]+)\s*\+/)?.[1];
  if (concatenated !== undefined && constants.has(concatenated)) {
    return constants.get(concatenated);
  }

  const templated = trimmed.match(/^`\$\{([A-Za-z0-9_]+)\}/)?.[1];
  if (templated !== undefined && constants.has(templated)) {
    return constants.get(templated);
  }

  const call = trimmed.match(/^([A-Za-z0-9_]+)\(/)?.[1];
  const body = call === undefined ? undefined : functions.get(call);
  return body === undefined
    ? undefined
    : resolveKey(body, constants, functions);
}

export interface StorageWrites {
  /** Keys passed to `setItem`. A comment, a read, and a bare literal do not count. */
  readonly written: readonly string[];
  /** A `setItem` whose key this scanner could not follow. Fail closed on these. */
  readonly unresolved: readonly string[];
}

/**
 * Keys a file actually passes to `setItem`. A literal, a comment, a read,
 * and an error string do not count.
 */
export function storageWrites(source: string): StorageWrites {
  const code = withoutComments(source);
  const constants = stringConstants(code);
  const functions = returnedExpressions(code);
  const written: string[] = [];
  const unresolved: string[] = [];

  for (const match of code.matchAll(/\.setItem\(\s*([\s\S]*?)\s*,/g)) {
    const expression = match[1];
    if (expression === undefined) continue;
    const key = resolveKey(expression, constants, functions);
    if (key === undefined) unresolved.push(expression.trim());
    else written.push(key.replace(/[.:]+$/, ""));
  }

  return { written, unresolved };
}

function normalizeKey(key: string): string {
  return key.replace(/[.:]+$/, "");
}

function filesOf(files: readonly string[]): {
  readonly written: ReadonlySet<string>;
  readonly unresolved: readonly string[];
} {
  const written = new Set<string>();
  const unresolved: string[] = [];
  for (const file of files) {
    const writes = storageWrites(readFileSync(file, "utf8"));
    for (const key of writes.written) written.add(key);
    for (const expression of writes.unresolved) {
      unresolved.push(`${relative(ROOT, file)}: ${expression}`);
    }
  }
  return { written, unresolved };
}

describe("State placement contract", () => {
  const writes = filesOf(clientSources());
  const written = writes.written;

  it("follows a setItem and ignores a comment, a read, and a bare literal", () => {
    const source = `
      const KEPT = "nilx-one.kept.v1.";
      function storageKey(owner: string): string {
        return KEPT + owner;
      }
      storage.setItem(storageKey(owner), "x");
      window.localStorage.getItem("nilx-one.read.v1");
      const UNREAD = "nilx-one.unread.v1";
      // nilx-one.commented.v1 is not a write
      const mentioned = "nilx-one.mentioned.v1";
      void mentioned;
      void UNREAD;
    `;

    expect(storageWrites(source)).toEqual({
      written: ["nilx-one.kept.v1"],
      unresolved: [],
    });
  });

  it("resolves every setItem the client makes", () => {
    expect(writes.unresolved).toEqual([]);
  });

  it("places every localStorage key a setItem writes", () => {
    const unplaced = [...written].filter(
      (key) => placedStateForKey(key) === undefined,
    );

    expect(unplaced).toEqual([]);
  });

  it("names no localStorage key the client no longer writes", () => {
    const stale = STATE_PLACEMENT.filter(
      (record) =>
        record.medium === "local-storage" &&
        record.legacy !== true &&
        !written.has(normalizeKey(record.key)),
    ).map((record) => record.key);

    expect(stale).toEqual([]);
  });

  it("still reads a legacy key it no longer writes", () => {
    const sources = clientSources()
      .map((file) => withoutComments(readFileSync(file, "utf8")))
      .join("\n");
    const missing = STATE_PLACEMENT.filter(
      (record) => record.legacy === true && !sources.includes(record.key),
    ).map((record) => record.key);

    expect(missing).toEqual([]);
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

  it("gives the network no device-resident or transport-eligible key to read", () => {
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

  it("refuses a server placement whose bytes are not in the service", () => {
    const contradictions = STATE_PLACEMENT.filter(
      (record) =>
        !placementAgreesWithMedium(record) ||
        !mobilityAgreesWithPlacement(record),
    ).map((record) => record.id);

    expect(contradictions).toEqual([]);
  });
});
