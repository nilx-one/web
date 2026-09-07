// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const ALLOWED_INTERNAL_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  application: [],
  "core-wasm": ["@nilx-one/application"],
  graphics: [],
  "identity-http": ["@nilx-one/application"],
  "host-browser": ["@nilx-one/host-contract"],
  "host-contract": [],
  "host-discord": ["@nilx-one/host-contract"],
  "host-telegram": ["@nilx-one/host-contract"],
  "map-contract": [],
  "map-maplibre": ["@nilx-one/map-contract"],
  "product-app": [
    "@nilx-one/application",
    "@nilx-one/host-contract",
    "@nilx-one/map-contract",
    "@nilx-one/ui",
  ],
  ui: [],
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === "node_modules" || entry === "dist") {
      return [];
    }

    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function internalImports(source: string): string[] {
  return [
    ...source.matchAll(/from\s+["'](@nilx-one\/[a-z-]+)(?:\/[^"']*)?["']/g),
  ].map((match) => match[1] ?? "");
}

describe("Clean Architecture boundaries", () => {
  it("keeps internal package imports pointing inward", () => {
    const violations: string[] = [];

    for (const [packageName, allowedImports] of Object.entries(
      ALLOWED_INTERNAL_IMPORTS,
    )) {
      const directory = join(ROOT, "packages", packageName, "src");

      for (const file of sourceFiles(directory)) {
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
  });

  it("isolates Telegram globals in the Telegram host adapter", () => {
    const violations: string[] = [];

    for (const scope of ["apps", "packages"] as const) {
      for (const file of sourceFiles(join(ROOT, scope))) {
        const normalized = relative(ROOT, file);

        if (normalized.startsWith("packages/host-telegram/")) {
          continue;
        }

        const source = readFileSync(file, "utf8");

        if (/Telegram\.WebApp|window\.Telegram/.test(source)) {
          violations.push(normalized);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("isolates the Discord SDK in the Discord host adapter", () => {
    const violations: string[] = [];

    for (const scope of ["apps", "packages"] as const) {
      for (const file of sourceFiles(join(ROOT, scope))) {
        const normalized = relative(ROOT, file);

        if (normalized.startsWith("packages/host-discord/")) {
          continue;
        }

        const source = readFileSync(file, "utf8");

        if (source.includes("@discord/embedded-app-sdk")) {
          violations.push(normalized);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps device geolocation behind the host capability boundary", () => {
    const violations: string[] = [];

    for (const scope of ["apps", "packages"] as const) {
      for (const file of sourceFiles(join(ROOT, scope))) {
        const normalized = relative(ROOT, file);

        // The browser adapter is the one place that may touch the platform
        // API; every other surface reads the host capability instead.
        if (normalized.startsWith("packages/host-browser/")) {
          continue;
        }

        const source = readFileSync(file, "utf8");

        if (/navigator\.geolocation|navigator\.permissions/.test(source)) {
          violations.push(normalized);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("never lets the map renderer ask for a device position", () => {
    const violations: string[] = [];

    for (const file of sourceFiles(join(ROOT, "packages/map-maplibre/src"))) {
      const source = readFileSync(file, "utf8");

      // The renderer draws an observation the application supplies. It never
      // acquires one, and it never learns about permission at all.
      if (
        /getCurrentPosition|watchPosition|GeolocationPermission/.test(source)
      ) {
        violations.push(relative(ROOT, file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the device observation out of persistence and telemetry", () => {
    // The modules that hold or draw an observed position. An observation is
    // ephemeral client evidence: it may reach the screen and nothing else.
    const locationModules = [
      "packages/product-app/src/features/map/device-location.ts",
      "packages/product-app/src/features/map/use-device-location.ts",
      "packages/product-app/src/features/map/location-camera-policy.ts",
      "packages/product-app/src/features/map/location-control.tsx",
      "packages/product-app/src/features/map/location-control-view-model.ts",
      "packages/map-maplibre/src/observed-position.ts",
      "packages/map-maplibre/src/observed-position-label.ts",
    ];
    const violations: string[] = [];

    for (const module of locationModules) {
      const source = readFileSync(join(ROOT, module), "utf8");

      if (
        /console\.|\bfetch\(|localStorage|sessionStorage|indexedDB|reporter/.test(
          source,
        )
      ) {
        violations.push(module);
      }
    }

    expect(violations).toEqual([]);
  });

  it("never introduces a Canvas 2D rendering fallback", () => {
    const violations: string[] = [];

    for (const scope of ["apps", "packages"] as const) {
      for (const file of sourceFiles(join(ROOT, scope))) {
        const source = readFileSync(file, "utf8");

        if (/getContext\(\s*["']2d["']\s*\)/.test(source)) {
          violations.push(relative(ROOT, file));
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
