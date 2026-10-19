// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const HOSTS = ["site", "telegram-mini-app", "discord-activity"] as const;

const PNG_DIMENSIONS = {
  "favicon.png": 96,
  "favicon-32x32.png": 32,
  "apple-touch-icon.png": 180,
} as const;

function asset(host: (typeof HOSTS)[number], name: string): Buffer {
  return readFileSync(resolve("apps", host, "public", name));
}

function pngDimension(data: Buffer): { width: number; height: number } {
  expect(data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe("host favicon assets", () => {
  for (const [name, size] of Object.entries(PNG_DIMENSIONS)) {
    it(`${name} is a square ${size}px image shared by all hosts`, () => {
      const canonical = asset("site", name);
      expect(pngDimension(canonical)).toEqual({ width: size, height: size });
      for (const host of HOSTS) {
        expect(asset(host, name)).toEqual(canonical);
      }
    });
  }

  it("ships one multi-resolution ICO containing 16, 32 and 48px", () => {
    const canonical = asset("site", "favicon.ico");
    expect(canonical.readUInt16LE(0)).toBe(0);
    expect(canonical.readUInt16LE(2)).toBe(1);
    const count = canonical.readUInt16LE(4);
    expect(count).toBe(3);
    const sizes = Array.from({ length: count }, (_, index) => {
      const offset = 6 + index * 16;
      const width = canonical.readUInt8(offset) || 256;
      const height = canonical.readUInt8(offset + 1) || 256;
      expect(height).toBe(width);
      return width;
    });
    expect(sizes.sort((a, b) => a - b)).toEqual([16, 32, 48]);
    for (const host of HOSTS) {
      expect(asset(host, "favicon.ico")).toEqual(canonical);
    }
  });

  it("references available icons with host-relative URLs", () => {
    for (const host of HOSTS) {
      const html = readFileSync(resolve("apps", host, "index.html"), "utf8");
      for (const name of [
        "favicon.ico",
        "favicon-32x32.png",
        "favicon.png",
        "apple-touch-icon.png",
      ]) {
        expect(html).toContain(`href="./${name}"`);
      }
      expect(html).toContain('rel="apple-touch-icon"');
    }
  });
});
