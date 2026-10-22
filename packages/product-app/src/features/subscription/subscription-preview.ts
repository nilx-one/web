// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export type SubscriptionPreviewPhase = "special" | "exclusive" | "none";
const PHASES: readonly SubscriptionPreviewPhase[] = [
  "special",
  "exclusive",
  "none",
];
const MINUTE_MS = 60_000;

/** Presentation-only clock; never writes an entitlement or calls Core grant. */
export function createSubscriptionPreview() {
  let phase: SubscriptionPreviewPhase = "special";
  let started = 0;
  let elapsed = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const tick = () => {
    clearTimeout(timer);
    // Catch up after background throttling without extending any phase.
    elapsed = Math.max(elapsed, Date.now() - started);
    const next = PHASES[Math.floor(elapsed / MINUTE_MS) % PHASES.length]!;
    if (next !== phase) {
      phase = next;
      for (const listener of listeners) listener();
    }
    timer = setTimeout(tick, MINUTE_MS - (elapsed % MINUTE_MS));
  };
  return {
    getSnapshot: () => phase,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        started = Date.now();
        elapsed = 0;
        phase = "special";
        tick();
        window.addEventListener("focus", tick);
        document.addEventListener("visibilitychange", tick);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearTimeout(timer);
          window.removeEventListener("focus", tick);
          document.removeEventListener("visibilitychange", tick);
          phase = "special";
        }
      };
    },
  };
}
