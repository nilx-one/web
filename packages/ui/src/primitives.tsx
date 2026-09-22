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

export interface ProgressBarProps {
  /** 0–1. A ratio outside that range is clamped rather than rendered as-is. */
  ratio: number;
  label: string;
}

/**
 * A determinate progress bar for a download or a load whose size is already known.
 *
 * There is no indeterminate variant here: a caller with nothing to report a ratio for has
 * nothing honest to show in this shape, and should render a `RuntimeStatus` instead.
 */
export function ProgressBar({ ratio, label }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);

  return (
    <div className="progress-bar">
      <div
        className="progress-bar__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="progress-bar__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="progress-bar__label">
        {label} — {percent}%
      </p>
    </div>
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
