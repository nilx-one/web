// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Local feedback only, after a real flight collision; no reward is issued.
 * Telegram Mini Apps provide native impact feedback. The browser Vibration
 * API is optional (not implemented by iOS Safari).
 */
export function flightLootHaptic(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
    return false;
  const telegram = (
    window as Window & {
      Telegram?: {
        WebApp?: {
          HapticFeedback?: { impactOccurred(style: "light"): void };
        };
      };
    }
  ).Telegram?.WebApp?.HapticFeedback;
  if (telegram?.impactOccurred) {
    try {
      telegram.impactOccurred("light");
      return true;
    } catch {
      // A host can expose a bridge but decline vibration: use the fallback.
    }
  }
  try {
    return typeof navigator.vibrate === "function" && navigator.vibrate(12);
  } catch {
    return false;
  }
}
