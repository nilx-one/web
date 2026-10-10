// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useState } from "react";

import type { ToastPlacement } from "./toast";

export type StatusToastKind = "active" | "loading" | "warning" | "error";

/** Whose a toast is, when it is someone's: the Bond's blue, its Avaia's violet. */
export type StatusToastTone = "bond" | "avaia";

export interface StatusToastItem {
  readonly id: string;
  readonly kind: StatusToastKind;
  readonly title: string;
  readonly description?: string;
  readonly dismissible?: boolean;
  readonly tone?: StatusToastTone;
}

/** Words the stack itself supplies; a localized host passes its own. */
export interface StatusToastCopy {
  readonly readMore: string;
  readonly readLess: string;
  readonly dismiss: string;
}

export const STATUS_TOAST_COPY: StatusToastCopy = {
  readMore: "Read more",
  readLess: "Read less",
  dismiss: "Dismiss",
};

export interface StatusToastStackProps {
  readonly toasts: readonly StatusToastItem[];
  readonly label?: string;
  readonly maxVisible?: number;
  readonly placement?: ToastPlacement;
  readonly copy?: StatusToastCopy;
  onDismiss(id: string): void;
}

/** Longer than this and a compact status surface needs an expansion control. */
const COLLAPSED_DESCRIPTION_LIMIT = 88;

function isDismissible(toast: StatusToastItem): boolean {
  return toast.kind !== "loading" && toast.dismissible !== false;
}

function StatusToast({
  toast,
  copy,
  onDismiss,
}: {
  readonly toast: StatusToastItem;
  readonly copy: StatusToastCopy;
  onDismiss(id: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand =
    toast.description !== undefined &&
    toast.description.length > COLLAPSED_DESCRIPTION_LIMIT;

  return (
    <div
      className={`toast status-toast status-toast--${toast.kind}${
        toast.tone === undefined ? "" : ` status-toast--tone-${toast.tone}`
      }`}
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
                {expanded ? copy.readLess : copy.readMore}
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
            aria-label={`${copy.dismiss}: ${toast.title}`}
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
  copy = STATUS_TOAST_COPY,
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
            <StatusToast toast={toast} copy={copy} onDismiss={onDismiss} />
          </li>
        ))}
      </ol>
    </div>
  );
}
