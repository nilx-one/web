// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const LOCAL_PRESENCE_IMPORTS: Readonly<Record<string, readonly string[]>> = {
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

function localPresenceFiles(): string[] {
  return Object.keys(LOCAL_PRESENCE_IMPORTS).flatMap((packageName) =>
    sourceFiles(join(ROOT, "packages", packageName, "src")),
  );
}

describe("Presence privacy boundary", () => {
  it(
    "keeps every local presence package on an explicit inward dependency surface",
    () => {
      const violations: string[] = [];

      for (const [packageName, allowedImports] of Object.entries(
        LOCAL_PRESENCE_IMPORTS,
      )) {
        for (const file of sourceFiles(
          join(ROOT, "packages", packageName, "src"),
        )) {
          const source = readFileSync(file, "utf8");

          for (const importedPackage of internalImports(source)) {
            if (!allowedImports.includes(importedPackage)) {
              violations.push(
                `${relative(ROOT, file)} imports forbidden ${importedPackage}`,
              );
            }
          }
        }
      }

      expect(violations).toEqual([]);
    },
  );

  it(
    "forbids network, telemetry and debug egress from local presence code",
    () => {
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

      for (const file of localPresenceFiles()) {
        const source = readFileSync(file, "utf8");

        for (const [boundary, pattern] of forbidden) {
          if (pattern.test(source)) {
            violations.push(`${relative(ROOT, file)} crosses ${boundary}`);
          }
        }
      }

      expect(violations).toEqual([]);
    },
  );

  it("keeps network and telemetry adapters presence-blind", () => {
    const boundaryFiles = [
      "apps/site/src/error-reporting.ts",
      "packages/identity-http/package.json",
      "services/identity/Cargo.toml",
      ...sourceFiles(join(ROOT, "packages/identity-http/src")).map((file) =>
        relative(ROOT, file),
      ),
    ];
    const forbidden =
      /@nilx-one\/(?:presence-[a-z-]+|map-shade)|(?:presence-contract|presence-geo|presence-idb|map-shade)/;
    const violations = boundaryFiles.filter((file) =>
      forbidden.test(readFileSync(join(ROOT, file), "utf8")),
    );

    expect(violations).toEqual([]);
  });
});
