// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Whether this person asked not to be moved.
 *
 * One answer for the whole interface: a camera that eases, a body that plays
 * an ambient clip and anything else that moves all read the same request, so
 * a person who asked once is not moved by whichever surface forgot.
 */
export function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}
