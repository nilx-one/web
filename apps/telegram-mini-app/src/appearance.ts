// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  syncTelegramChrome,
  type TelegramWebAppBridge,
} from "@nilx-one/host-telegram";
import {
  APPEARANCE_ATTRIBUTE,
  readAppearancePreference,
  resolveAppearance,
  type ResolvedAppearance,
} from "@nilx-one/product-app/appearance";

function projectedAppearance(root: Element): ResolvedAppearance | undefined {
  const value = root.getAttribute(APPEARANCE_ATTRIBUTE);
  return value === "light" || value === "dark" ? value : undefined;
}

/**
 * Start with the same resolved answer the shared appearance store will paint:
 * an explicit preference wins, while `auto` follows Telegram's device theme.
 */
export function initialTelegramAppearance(
  bridge: TelegramWebAppBridge,
): ResolvedAppearance {
  return resolveAppearance(readAppearancePreference(), bridge.colorScheme);
}

/**
 * Keep Telegram-owned surfaces in step with the shared document projection.
 * The product remains the appearance authority; this composition only observes
 * its resolved root attribute and asks the Telegram adapter to mirror it.
 */
export function startTelegramChromeAppearanceSync(
  bridge: TelegramWebAppBridge | undefined,
  root: Element = document.documentElement,
): () => void {
  if (bridge === undefined) {
    return () => undefined;
  }

  let applied = projectedAppearance(root) ?? initialTelegramAppearance(bridge);
  syncTelegramChrome(bridge, applied);

  if (typeof MutationObserver === "undefined") {
    return () => undefined;
  }

  const observer = new MutationObserver(() => {
    const next = projectedAppearance(root);
    if (next === undefined || next === applied) {
      return;
    }
    applied = next;
    syncTelegramChrome(bridge, next);
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: [APPEARANCE_ATTRIBUTE],
  });

  return () => observer.disconnect();
}
