// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

import "./public-bond.css";

export interface PublicBondProjection {
  pubDress: string;
  pubDressUrl: string;
  avaiaPubDress?: string;
  avatarModel?: string;
}

export type PublicBondState =
  | { kind: "loading" }
  | { kind: "ready"; bond: PublicBondProjection }
  | { kind: "not-found" }
  | { kind: "unavailable" };

interface PublicBondPageProps {
  fetchImpl?: typeof globalThis.fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseProjection(value: unknown): PublicBondProjection | undefined {
  if (
    !isRecord(value) ||
    typeof value.pub_dress !== "string" ||
    typeof value.pub_dress_url !== "string"
  ) {
    return undefined;
  }
  return {
    pubDress: value.pub_dress,
    pubDressUrl: value.pub_dress_url,
    ...(typeof value.avaia_pub_dress === "string"
      ? { avaiaPubDress: value.avaia_pub_dress }
      : {}),
    ...(typeof value.avatar_model === "string"
      ? { avatarModel: value.avatar_model }
      : {}),
  };
}

export function isPublicBondHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  const zone = ".nilx.one";
  if (!normalized.endsWith(zone)) {
    return false;
  }
  const label = normalized.slice(0, -zone.length);
  return (
    label.length > 0 &&
    !label.includes(".") &&
    (label.startsWith("0x") || label.startsWith("xn--"))
  );
}

export async function readPublicBond(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<PublicBondState> {
  try {
    const response = await fetchImpl("/api/v1/identity/public", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 404) {
      return { kind: "not-found" };
    }
    if (!response.ok) {
      return { kind: "unavailable" };
    }
    const projection = parseProjection(await response.json());
    return projection === undefined
      ? { kind: "unavailable" }
      : { kind: "ready", bond: projection };
  } catch {
    return { kind: "unavailable" };
  }
}

function PublicBondCard({ bond }: { bond: PublicBondProjection }) {
  return (
    <main className="public-bond-page">
      <article
        className="public-bond-card"
        aria-labelledby="public-bond-title"
      >
        <p className="public-bond-kicker">0x1 · Bond</p>
        <h1 id="public-bond-title">{bond.pubDress}</h1>
        <a className="public-bond-address" href={bond.pubDressUrl}>
          {bond.pubDressUrl.replace(/^https:\/\//, "")}
        </a>

        <dl className="public-bond-facts">
          {bond.avaiaPubDress === undefined ? null : (
            <div>
              <dt>Avaia</dt>
              <dd>{bond.avaiaPubDress}</dd>
            </div>
          )}
          {bond.avatarModel === undefined ? null : (
            <div>
              <dt>body</dt>
              <dd>{bond.avatarModel}</dd>
            </div>
          )}
        </dl>

        <a className="public-bond-home" href="https://nilx.one/">
          enter nilx.one <span aria-hidden="true">↗</span>
        </a>
      </article>
      <footer>© 2026 aiaiaiai · aiaiaiai.org</footer>
    </main>
  );
}

function PublicBondMessage({
  state,
}: {
  state: "not-found" | "unavailable";
}) {
  return (
    <main className="public-bond-page">
      <section
        className="public-bond-card public-bond-card--message"
        role="status"
      >
        <p className="public-bond-kicker">0x1 · Bond</p>
        <h1>
          {state === "not-found"
            ? "Bond not found."
            : "Temporarily unavailable."}
        </h1>
        <p>
          {state === "not-found"
            ? "No Bond is allocated to this public address."
            : "The public identity service could not answer this address."}
        </p>
        <a className="public-bond-home" href="https://nilx.one/">
          nilx.one <span aria-hidden="true">↗</span>
        </a>
      </section>
      <footer>© 2026 aiaiaiai · aiaiaiai.org</footer>
    </main>
  );
}

export function PublicBondPage({ fetchImpl }: PublicBondPageProps) {
  const [state, setState] = useState<PublicBondState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void readPublicBond(fetchImpl).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [fetchImpl]);

  if (state.kind === "ready") {
    return <PublicBondCard bond={state.bond} />;
  }
  if (state.kind === "not-found" || state.kind === "unavailable") {
    return <PublicBondMessage state={state.kind} />;
  }
  return (
    <main className="public-bond-page" aria-busy="true">
      <section className="public-bond-card public-bond-card--message">
        <p className="public-bond-kicker">0x1 · Bond</p>
        <h1>Resolving address…</h1>
      </section>
    </main>
  );
}
