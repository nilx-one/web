// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CellIndex, PresenceStore, ShadeSource } from "./index";

/**
 * A {@link ShadeSource} with a lifecycle. The renderer is handed the narrow
 * half; whoever composed it keeps the half that starts and stops.
 */
export interface ManagedShadeSource extends ShadeSource {
  start(): Promise<void>;
  stop(): void;
}

/**
 * Projects a journal down to the only thing the renderer may see: which cells
 * are lit.
 *
 * Every cell this source learns about is announced through `onCellLit`,
 * including the ones already in the journal when it started. A renderer that
 * both replays `litCells()` and listens is therefore correct whatever order
 * those two happen in, and needs no readiness signal from the store.
 */
export function createShadeSource(store: PresenceStore): ManagedShadeSource {
  const lit = new Set<CellIndex>();
  const listeners = new Set<(cell: CellIndex) => void>();
  let unsubscribe: (() => void) | undefined;
  let stopped = false;

  function light(cell: CellIndex): void {
    if (lit.has(cell)) {
      return;
    }
    lit.add(cell);
    // Copied so a listener that unsubscribes itself cannot disturb the walk.
    for (const listener of [...listeners]) {
      listener(cell);
    }
  }

  return {
    litCells: () => [...lit],

    onCellLit(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    async start() {
      stopped = false;
      // Subscribed before the read, so an append that lands while the journal
      // is being listed is seen rather than dropped between the two.
      unsubscribe ??= store.subscribe((record) => {
        light(record.cell);
      });
      const cells = await store.listCells();
      if (stopped) {
        return;
      }
      for (const cell of cells) {
        light(cell);
      }
    },

    stop() {
      stopped = true;
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}

/**
 * Strips the lifecycle off, leaving only what the renderer may hold.
 *
 * The type boundary is the real one, but handing a renderer an object that
 * physically has no `start`, no `stop`, and no route to the store means the
 * boundary survives a cast, a plugin, and a stray `as never`.
 */
export function toShadeSource(source: ShadeSource): ShadeSource {
  return {
    litCells: () => source.litCells(),
    onCellLit: (fn) => source.onCellLit(fn),
  };
}
