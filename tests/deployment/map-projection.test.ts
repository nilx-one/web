// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface ProjectionStyle {
  readonly projection?: {
    readonly type?: unknown;
  };
}

const APPEARANCE_FILES = [
  "deploy/web/map/0.1.0/style.json",
  "deploy/web/map/0.1.0/style-dark.json",
] as const;

function readProjection(path: string): ProjectionStyle["projection"] {
  const style = JSON.parse(
    readFileSync(resolve(path), "utf8"),
  ) as ProjectionStyle;
  return style.projection;
}

describe("published map projection", () => {
  it.each(APPEARANCE_FILES)(
    "%s keeps the world on MapLibre's adaptive globe projection",
    (path) => {
      expect(readProjection(path)).toEqual({ type: "globe" });
    },
  );

  it("keeps the globe contract across an appearance style swap", () => {
    expect(readProjection(APPEARANCE_FILES[0])).toEqual(
      readProjection(APPEARANCE_FILES[1]),
    );
  });
});
