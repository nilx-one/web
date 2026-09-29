// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export type ImpactStyle = "light" | "medium" | "heavy";

/**
 * The web has no haptics API of its own, only two side doors. Android and
 * other Vibration API browsers take a short pulse. iOS Safari (17.4+) exposes
 * none, but toggling a native `switch` checkbox plays the system's selection
 * tick on the Taptic Engine — so a hidden one is flipped instead. Everything
 * else is a quiet no-op: feedback is presentation and never a requirement.
 */
export interface BrowserHapticsEnvironment {
  readonly vibrate?: (pattern: number) => boolean;
  readonly document?: Document;
}

const PULSE_MS: Record<ImpactStyle, number> = {
  light: 8,
  medium: 14,
  heavy: 22,
};

function defaultEnvironment(): BrowserHapticsEnvironment {
  if (typeof navigator === "undefined" || typeof document === "undefined") {
    return {};
  }
  return {
    ...(typeof navigator.vibrate === "function"
      ? { vibrate: (pattern: number) => navigator.vibrate(pattern) }
      : {}),
    document,
  };
}

function switchTick(doc: Document): void {
  const label = doc.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.append(input);
  doc.body.append(label);
  // The label, not the input: that is the path Safari answers with a tick.
  label.click();
  label.remove();
}

export function createBrowserHaptics(
  environment: BrowserHapticsEnvironment = defaultEnvironment(),
): (style: ImpactStyle) => void {
  return (style) => {
    try {
      if (environment.vibrate !== undefined) {
        environment.vibrate(PULSE_MS[style]);
        return;
      }
      if (environment.document?.body != null) switchTick(environment.document);
    } catch {
      // Best-effort presentation; a refused pulse changes nothing.
    }
  };
}
