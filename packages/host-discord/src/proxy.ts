// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Discord serves an Activity from `<client_id>.discordsays.com` and answers
 * every request that origin makes through its own proxy. Only paths below
 * `/.proxy/` are matched against the Activity URL mappings; an unprefixed
 * `/api/v1/...` request is answered by the client's own root mapping instead,
 * so it never reaches the identity service and the Activity dies before it can
 * authenticate.
 *
 * The client publishes one set of absolute runtime paths for every host. Inside
 * Discord — and only inside Discord — those paths are re-rooted under the proxy
 * prefix, so no other host learns that Discord exists.
 */
export const DISCORD_PROXY_PREFIX = "/.proxy";

const DISCORD_ACTIVITY_HOST_SUFFIX = ".discordsays.com";

/** The part of a browser location the proxy boundary depends on. */
export interface DiscordProxyLocation {
  readonly hostname: string;
  readonly origin: string;
}

export function isDiscordProxiedLocation(
  location: DiscordProxyLocation,
): boolean {
  return location.hostname.endsWith(DISCORD_ACTIVITY_HOST_SUFFIX);
}

function proxiedPath(pathname: string): string {
  if (
    pathname === DISCORD_PROXY_PREFIX ||
    pathname.startsWith(`${DISCORD_PROXY_PREFIX}/`)
  ) {
    return pathname;
  }

  return `${DISCORD_PROXY_PREFIX}${pathname}`;
}

/**
 * Re-roots an absolute same-origin URL under the Discord proxy prefix. A
 * document-relative reference resolves against the already proxied document, a
 * foreign origin is Discord's to allow or refuse, and neither is rewritten.
 */
export function resolveDiscordProxyUrl(
  url: string,
  location: DiscordProxyLocation,
): string {
  if (!isDiscordProxiedLocation(location)) {
    return url;
  }

  if (url.startsWith("//")) {
    return url;
  }

  if (url.startsWith("/")) {
    const separator = url.search(/[?#]/);
    return separator === -1
      ? proxiedPath(url)
      : `${proxiedPath(url.slice(0, separator))}${url.slice(separator)}`;
  }

  let absolute: URL;
  try {
    absolute = new URL(url);
  } catch {
    return url;
  }

  if (absolute.origin !== location.origin) {
    return url;
  }

  absolute.pathname = proxiedPath(absolute.pathname);
  return absolute.href;
}

/**
 * Wraps a fetch so every absolute same-origin request it makes travels through
 * the Discord proxy. Outside Discord the original fetch is returned unchanged.
 */
export function createDiscordProxyFetch(
  fetch: typeof globalThis.fetch,
  location: DiscordProxyLocation,
): typeof globalThis.fetch {
  if (!isDiscordProxiedLocation(location)) {
    return fetch;
  }

  return async (input, init) => {
    if (typeof input === "string") {
      return fetch(resolveDiscordProxyUrl(input, location), init);
    }

    if (input instanceof URL) {
      return fetch(resolveDiscordProxyUrl(input.href, location), init);
    }

    return fetch(
      new Request(resolveDiscordProxyUrl(input.url, location), input),
      init,
    );
  };
}

/** The part of the global scope the proxy routing installs itself into. */
export interface DiscordProxyScope {
  fetch: typeof globalThis.fetch;
  readonly location: DiscordProxyLocation;
}

/**
 * Routes the whole client through the Discord proxy.
 *
 * The map style, the basemap archive, and the Core Wasm artifact are fetched by
 * libraries that own their own transport, so the proxy boundary is installed on
 * the scope they share instead of being threaded through every adapter. Outside
 * Discord this changes nothing. Returns the undo, which restores the original
 * fetch.
 */
export function installDiscordProxyRouting(
  scope: DiscordProxyScope = globalThis,
): () => void {
  if (!isDiscordProxiedLocation(scope.location)) {
    return () => undefined;
  }

  const original = scope.fetch;
  scope.fetch = createDiscordProxyFetch(original.bind(scope), scope.location);

  return () => {
    scope.fetch = original;
  };
}
