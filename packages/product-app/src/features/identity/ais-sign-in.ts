// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Signing in through aiaiaiai Identity, the one sign-in page for 0x1.
 *
 * The site never handles a password for this path: it sends the browser to its
 * own host route, which starts the OpenID Connect request (state, nonce, PKCE)
 * and returns here with a product session. A failed return arrives as
 * `?auth_error=<code>`; this module only reads it.
 */

const START_PATH = "/api/v1/auth/aiaiaiai/start";

/** Why a return from aiaiaiai did not sign the person in. */
export type AisSignInFailure =
  "address-taken" | "address-missing" | "unavailable" | "other";

/**
 * The host route that begins the sign-in. `returnPath` must be a same-origin
 * path; anything else falls back to `/`, as the host does.
 */
export function aisSignInHref(returnPath = "/"): string {
  const safe =
    returnPath.startsWith("/") &&
    !returnPath.startsWith("//") &&
    !returnPath.includes("\\") &&
    returnPath.length <= 512
      ? returnPath
      : "/";
  return `${START_PATH}?return=${encodeURIComponent(safe)}`;
}

/** The failure a return from aiaiaiai reported, if any. */
export function readAisSignInFailure(
  search: string,
): AisSignInFailure | undefined {
  const code = new URLSearchParams(search).get("auth_error");
  if (code === null || code === "") return undefined;
  switch (code) {
    case "bond_address_taken":
      return "address-taken";
    case "bond_address_missing":
      return "address-missing";
    case "bond_unavailable":
    case "aiaiaiai_sign_in_unavailable":
    case "product_service_unavailable":
      return "unavailable";
    default:
      return "other";
  }
}
