// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useState, type CSSProperties } from "react";

export type StatusToastKind = "active" | "loading" | "warning" | "error";

export interface StatusToastItem {
  readonly id: string;
  readonly kind: StatusToastKind;
  readonly title: string;
  readonly description?: string;
  /**
   * Loading is intentionally never dismissible. Other notices default to true.
   */
  readonly dismissible?: boolean;
}

export interface StatusToastStackProps {
  readonly toasts: readonly StatusToastItem[];
  readonly label?: string;
  readonly maxVisible?: number;
  onDismiss(id: string): void;
}

const markerByKind: Readonly<Record<StatusToastKind, string>> = {
  active: "var(--positive)",
  loading: "#22d3ee",
  warning: "var(--warning)",
  error: "var(--negative)",
};

const regionStyle: CSSProperties = {
  top: "calc(16px + var(--safe-top, env(safe-area-inset-top, 0px)))",
  right: "auto",
  bottom: "auto",
  left: "calc(16px + var(--safe-left, env(safe-area-inset-left, 0px)))",
  justifyContent: "flex-start",
};

const listStyle: CSSProperties = {
  width: "min(calc(100vw - 32px), 420px)",
};

const toastStyle: CSSProperties = {
  minHeight: 64,
};

const markerStyle: CSSProperties = {
  flex: "0 0 auto",
};

const descriptionCollapsedStyle: CSSProperties = {
  display: "-webkit-box",
  overflow: "hidden",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
};

const readMoreStyle: CSSProperties = {
  padding: 0,
  border: 0,
  marginTop: 6,
  background: "transparent",
  color: "var(--accent-ink)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

function isDismissible(toast: StatusToastItem): boolean {
  return toast.kind !== "loading" && toast.dismissible !== false;
}

function descriptionCanOverflow(description: string): boolean {
  return description.length > 88;
}

function StatusToast({
  toast,
  onDismiss,
}: {
  readonly toast: StatusToastItem;
  onDismiss(id: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand =
    toast.description !== undefined && descriptionCanOverflow(toast.description);

  return (
    <div
      className={`toast status-toast status-toast--${toast.kind}`}
      data-status-toast-kind={toast.kind}
      style={toastStyle}
    >
      <span
        className="toast__marker"
        aria-hidden="true"
        style={{
          ...markerStyle,
          background: markerByKind[toast.kind],
          boxShadow:
            toast.kind === "loading" ? "0 0 0 5px rgb(34 211 238 / 14%)" : undefined,
        }}
      />
      <div className="toast__body">
        <p className="toast__title">{toast.title}</p>
        {toast.description === undefined ? null : (
          <>
            <p
              className="toast__description"
              style={expanded ? undefined : descriptionCollapsedStyle}
            >
              {toast.description}
            </p>
            {canExpand ? (
              <button
                type="button"
                style={readMoreStyle}
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Read less" : "Read more"}
              </button>
            ) : null}
          </>
        )}
      </div>
      {isDismissible(toast) ? (
        <div className="toast__controls">
          <button
            className="toast__dismiss"
            type="button"
            aria-label={`Dismiss: ${toast.title}`}
            onClick={() => onDismiss(toast.id)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Status surface for transient client observations. Newest notices are shown
 * first and only the bounded tail remains visible; this is presentation state,
 * never protocol or Relationship truth.
 */
export function StatusToastStack({
  toasts,
  label = "Status notifications",
  maxVisible = 3,
  onDismiss,
}: StatusToastStackProps) {
  const visible = toasts.slice(-Math.max(0, maxVisible)).toReversed();

  return (
    <div
      className="toast-region status-toast-region"
      role="region"
      aria-label={label}
      style={regionStyle}
    >
      <ol
        className="toast-region__list"
        aria-live="polite"
        aria-relevant="additions text"
        style={listStyle}
      >
        {visible.map((toast) => (
          <li className="toast-region__item" key={toast.id}>
            <StatusToast toast={toast} onDismiss={onDismiss} />
          </li>
        ))}
      </ol>
    </div>
  );
}
