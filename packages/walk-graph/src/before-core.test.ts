// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { expect, it, vi } from "vitest";

// A fresh copy of the module, which no host has handed Core's walking graph:
// Web keeps no fallback, so nothing is walked along and nothing walks.
it("walks nowhere until Core's walking graph is installed", async () => {
  vi.resetModules();
  const walk = await import("./index");
  expect(walk.walkGraphCoreInstalled()).toBe(false);
  const graph = walk.buildWalkGraph([
    {
      kind: "path",
      lines: [
        [
          [30.5, 50.4],
          [30.501, 50.4],
        ],
      ],
    },
  ]);
  expect(graph.nodes).toEqual([]);
  expect(walk.snapToGraph(graph, [30.5, 50.4])).toBeNull();
  expect(walk.surfaceOf("path", "footway")).toBeNull();
  expect(walk.snapDistanceM()).toBe(0);
  expect(walk.grassWeight()).toBe(Infinity);
});
