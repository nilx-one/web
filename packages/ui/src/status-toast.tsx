// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useState } from "react";

import type { ToastPlacement } from "./toast";

export type StatusToastKind = "active" | "loading" | "warning" | "error";

export interface StatusToastItem {
  readonly id: string;
  readonly kind: StatusToastKind;
  readonly title: string;
  readonly description?: string;
  readonly dismissible?: boolean;
}

export interface StatusToastStackProps {
  readonly toasts: readonly StatusToastItem[];
  readonly label?: string;
  readonly maxVisible?: number;
  readonly placement?: ToastPlacement;
  onDismiss(id: string): void;
}

/** Longer than this and a compact status surface needs an expansion control. */
const COLLAPSED_DESCRIPTION_LIMIT = 88;

function isDismissible(toast: StatusToastItem): boolean {
  return toast.kind !== "loading" && toast.dismissible !== false;
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
    toast.description !== undefined &&
    toast.description.length > COLLAPSED_DESCRIPTION_LIMIT;

  return (
    <div
      className={`toast status-toast status-toast--${toast.kind}`}
      data-status-toast-kind={toast.kind}
    >
      <span className="toast__marker" aria-hidden="true" />
      <div className="toast__body">
        <p className="toast__title">{toast.title}</p>
        {toast.description === undefined ? null : (
          <>
            <p
              className={
                expanded
                  ? "toast__description"
                  : "toast__description toast__description--clamped"
              }
            >
              {toast.description}
            </p>
            {canExpand ? (
              <button
                className="status-toast__more"
                type="button"
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

export function StatusToastStack({
  toasts,
  label = "Status notifications",
  maxVisible = 3,
  placement = "viewport",
  onDismiss,
}: StatusToastStackProps) {
  const visible = toasts.slice(-Math.max(0, maxVisible)).toReversed();

  return (
    <div
      className={
        placement === "inline"
          ? "toast-region status-toast-region toast-region--inline"
          : "toast-region status-toast-region"
      }
      role="region"
      aria-label={label}
    >
      <ol
        className="toast-region__list"
        aria-live="polite"
        aria-relevant="additions text"
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
