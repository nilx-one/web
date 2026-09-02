// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import { createMapLibreRenderer } from "./index";

interface FakeMap {
  readonly once: (event: string, listener: () => void) => FakeMap;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly jumpTo: ReturnType<typeof vi.fn>;
  emit(event: string): void;
}

function makeFakeMap(): FakeMap {
  const listeners = new Map<string, () => void>();
  const fake: FakeMap = {
    once(event, listener) {
      listeners.set(event, listener);
      return fake;
    },
    remove: vi.fn(),
    jumpTo: vi.fn(),
    emit(event) {
      listeners.get(event)?.();
      listeners.delete(event);
    },
  };
  return fake;
}

describe("createMapLibreRenderer", () => {
  it("publishes loading then ready and owns renderer cleanup", () => {
    const fakeMap = makeFakeMap();
    const statuses: string[] = [];
    const createMap = vi.fn((_options: MapOptions) => fakeMap as unknown as MapLibreMap);
    const renderer = createMapLibreRenderer({ createMap });
    renderer.subscribe((status) => statuses.push(status.kind));

    renderer.mount(document.createElement("div"));
    expect(statuses).toEqual(["loading"]);

    fakeMap.emit("load");
    expect(renderer.getStatus()).toEqual({ kind: "ready" });

    renderer.setCamera({
      center: [10, 20],
      zoom: 4,
      bearing: 5,
      pitch: 6,
    });
    expect(fakeMap.jumpTo).toHaveBeenCalledWith({
      center: [10, 20],
      zoom: 4,
      bearing: 5,
      pitch: 6,
    });

    renderer.unmount();
    expect(fakeMap.remove).toHaveBeenCalledOnce();
    expect(renderer.getStatus()).toEqual({ kind: "unmounted" });
  });

  it("fails explicitly when the self-hosted style cannot load", () => {
    const fakeMap = makeFakeMap();
    const renderer = createMapLibreRenderer({
      createMap: (_options) => fakeMap as unknown as MapLibreMap,
    });

    renderer.mount(document.createElement("div"));
    fakeMap.emit("error");

    expect(renderer.getStatus()).toEqual({
      kind: "unavailable",
      reason: "style-load-failed",
    });
  });
});
