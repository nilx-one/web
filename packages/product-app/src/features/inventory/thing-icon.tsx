// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** Decorative silhouettes only; identity, size and price still come from Core. */
export function ThingIcon({ id }: { readonly id: string }) {
  let shape;
  if (id.includes("cassette") || id === "kyiv_mixtape") {
    shape = (
      <>
        <rect x="3" y="5" width="26" height="22" rx="4" />
        <circle cx="11" cy="14" r="3" />
        <circle cx="21" cy="14" r="3" />
        <path d="M11 14h10M9 27l2-6h10l2 6" />
      </>
    );
  } else if (id.includes("headphones")) {
    shape = (
      <>
        <path d="M6 19v-5a10 10 0 0 1 20 0v5" />
        <rect x="4" y="17" width="6" height="11" rx="2" />
        <rect x="22" y="17" width="6" height="11" rx="2" />
      </>
    );
  } else if (id === "bottle") {
    shape = (
      <>
        <path d="M13 3h6v6l4 5v13a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V14l4-5Z" />
        <path d="M9 18h14M13 6h6" />
      </>
    );
  } else if (id === "can") {
    shape = (
      <>
        <rect x="8" y="4" width="16" height="25" rx="4" />
        <path d="M8 10h16M8 24h16M14 7h4" />
      </>
    );
  } else if (["small_change", "metro_token", "bottle_cap"].includes(id)) {
    shape = (
      <>
        <circle cx="16" cy="16" r="11" />
        <circle cx="16" cy="16" r="6" />
      </>
    );
  } else if (
    ["scratched_cd", "album", "test_pressing", "kyiv_anthology"].includes(id)
  ) {
    shape = (
      <>
        <circle cx="16" cy="16" r="12" />
        <circle cx="16" cy="16" r="3" />
        <path d="m8 7 4 5m8 8 4 5" />
      </>
    );
  } else if (id === "flyer") {
    shape = (
      <>
        <path d="M8 3h12l5 5v21H8ZM20 3v6h5M12 14h9M12 19h9M12 24h5" />
      </>
    );
  } else {
    shape = (
      <>
        <rect x="5" y="5" width="22" height="22" rx="5" />
        <path d="M11 12h10M11 17h10M11 22h4" />
      </>
    );
  }
  return (
    <svg
      className="inventory__icon"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}
