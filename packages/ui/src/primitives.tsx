// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CSSProperties, ReactNode } from "react";

export interface AppChromeProps {
  children: ReactNode;
  footer: ReactNode;
  hostLabel: string;
  safeArea: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

interface SafeAreaStyle extends CSSProperties {
  "--safe-top": string;
  "--safe-right": string;
  "--safe-bottom": string;
  "--safe-left": string;
}

export function AppChrome({
  children,
  footer,
  hostLabel,
  safeArea,
}: AppChromeProps) {
  const style: SafeAreaStyle = {
    "--safe-top": `${safeArea.top}px`,
    "--safe-right": `${safeArea.right}px`,
    "--safe-bottom": `${safeArea.bottom}px`,
    "--safe-left": `${safeArea.left}px`,
  };

  return (
    <div className="app-chrome" style={style}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="0x1 home">
          <span aria-hidden="true">0x1</span>
        </a>
        <div className="host-label" aria-label={`Current host: ${hostLabel}`}>
          <span className="host-dot" aria-hidden="true" />
          {hostLabel}
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className="app-footer">{footer}</footer>
    </div>
  );
}

export interface RuntimeStatusProps {
  detail: string;
  label: string;
  tone: "blocked" | "loading" | "ready";
}

export function RuntimeStatus({ detail, label, tone }: RuntimeStatusProps) {
  return (
    <section className="runtime-status" aria-live="polite">
      <span className={`runtime-indicator runtime-indicator--${tone}`} />
      <div>
        <p className="runtime-label">{label}</p>
        <p className="runtime-detail">{detail}</p>
      </div>
    </section>
  );
}

export function PairwiseBoundary() {
  return (
    <figure className="pairwise-boundary">
      <div className="bond-node bond-node--zero">
        <span className="bond-index">0</span>
        <span className="bond-label">Bond</span>
      </div>
      <div className="boundary-line" aria-hidden="true">
        <span className="boundary-pulse" />
      </div>
      <div className="boundary-language">
        <span>intent</span>
        <span>reciprocal action</span>
        <strong>shared history</strong>
      </div>
      <div className="bond-node bond-node--one">
        <span className="bond-index">1</span>
        <span className="bond-label">Bond</span>
      </div>
      <figcaption>
        Bilateral truth begins only after the reciprocal action required by the
        interaction contract.
      </figcaption>
    </figure>
  );
}
