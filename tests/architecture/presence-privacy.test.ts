// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const LOCAL_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  "map-shade": ["@nilx-one/presence-contract"],
  "presence-contract": [],
  "presence-geo": ["@nilx-one/host-contract", "@nilx-one/presence-contract"],
  "presence-idb": ["@nilx-one/presence-contract"],
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === "node_modules" || entry === "dist") return [];

    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);

    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function internalImports(source: string): string[] {
  return [
    ...source.matchAll(/from\s+["'](@nilx-one\/[a-z-]+)(?:\/[^"']*)?["']/g),
  ].map((match) => match[1] ?? "");
}

function packageSources(packageName: string): string[] {
  const directory = join(ROOT, "packages", packageName, "src");
  return sourceFiles(directory);
}

function presenceSources(): string[] {
  return Object.keys(LOCAL_IMPORTS).flatMap(packageSources);
}

describe("Presence privacy boundary", () => {
  it("allows only local presence dependencies", () => {
    const violations: string[] = [];

    for (const [packageName, allowed] of Object.entries(LOCAL_IMPORTS)) {
      for (const file of packageSources(packageName)) {
        const source = readFileSync(file, "utf8");

        for (const imported of internalImports(source)) {
          if (!allowed.includes(imported)) {
            const path = relative(ROOT, file);
            violations.push(`${path} imports forbidden ${imported}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("forbids presence egress and debug logging", () => {
    const forbidden: readonly [string, RegExp][] = [
      ["4x-errors", /@aiaiaiai\/4x-errors-browser/],
      ["identity HTTP", /@nilx-one\/identity-http/],
      ["fetch", /\bfetch\s*\(/],
      ["XMLHttpRequest", /\bXMLHttpRequest\b/],
      ["sendBeacon", /\bsendBeacon\s*\(/],
      ["WebSocket", /\bWebSocket\b/],
      ["console", /\bconsole\./],
    ];
    const violations: string[] = [];

    for (const file of presenceSources()) {
      const source = readFileSync(file, "utf8");

      for (const [boundary, pattern] of forbidden) {
        if (pattern.test(source)) {
          const path = relative(ROOT, file);
          violations.push(`${path} crosses ${boundary}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps network adapters presence-blind", () => {
    const identitySources = packageSources("identity-http");
    const boundaryFiles = [
      "apps/site/src/error-reporting.ts",
      "packages/identity-http/package.json",
      "services/identity/Cargo.toml",
      ...identitySources.map((file) => relative(ROOT, file)),
    ];
    const forbidden =
      /@nilx-one\/(?:presence-[a-z-]+|map-shade)|(?:presence-contract|presence-geo|presence-idb|map-shade)/;
    const violations = boundaryFiles.filter((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      return forbidden.test(source);
    });

    expect(violations).toEqual([]);
  });
});
