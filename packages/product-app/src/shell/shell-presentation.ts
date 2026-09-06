// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

/**
 * Presentation density of the application chrome. Routes and information
 * architecture stay canonical at every width: only the way they are presented
 * changes.
 */
export type ShellPresentation = "compact" | "regular" | "wide";

/** Explicit URL-like route labels only earn their room on a wide viewport. */
const WIDE_MIN_WIDTH = 1024;
/** Below this a gear plus a host label crowds the header on a narrow phone. */
const REGULAR_MIN_WIDTH = 600;

export function shellPresentationForWidth(width: number): ShellPresentation {
  if (width >= WIDE_MIN_WIDTH) {
    return "wide";
  }
  if (width >= REGULAR_MIN_WIDTH) {
    return "regular";
  }
  return "compact";
}

function viewportWidth(): number {
  return document.documentElement.clientWidth || window.innerWidth;
}

/**
 * Resolves the presentation mode from the surface the shell actually occupies.
 * The shell fills the viewport in every host, so the viewport width is the
 * container width.
 */
export function useShellPresentation(): ShellPresentation {
  const [presentation, setPresentation] = useState<ShellPresentation>(() =>
    shellPresentationForWidth(viewportWidth()),
  );

  useEffect(() => {
    const update = () =>
      setPresentation(shellPresentationForWidth(viewportWidth()));

    // The first client measurement can differ from the one the initial state
    // read, so the mode is resolved once more before any resize arrives.
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return presentation;
}
