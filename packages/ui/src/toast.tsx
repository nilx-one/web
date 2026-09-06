// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export type ToastTone = "attention" | "critical" | "neutral";

/**
 * `viewport` anchors the region itself. `inline` hands anchoring to a shell
 * that already owns the toast stack's place in the layout.
 */
export type ToastPlacement = "viewport" | "inline";

export interface ToastAction {
  readonly label: string;
  onPerform(): void;
}

export interface ToastContent {
  readonly title: string;
  readonly tone: ToastTone;
  readonly action?: ToastAction;
  readonly description?: string;
  readonly details?: string;
}

export interface ToastProps extends ToastContent {
  onDismiss(): void;
}

export function Toast({
  title,
  tone,
  action,
  description,
  details,
  onDismiss,
}: ToastProps) {
  return (
    <div className={`toast toast--${tone}`}>
      <span className="toast__marker" aria-hidden="true" />
      <div className="toast__body">
        <p className="toast__title">{title}</p>
        {description === undefined ? null : (
          <p className="toast__description">{description}</p>
        )}
        {details === undefined ? null : (
          <details className="toast__details">
            <summary>Reference</summary>
            <p>{details}</p>
          </details>
        )}
      </div>
      <div className="toast__controls">
        {action === undefined ? null : (
          <button
            className="toast__action"
            type="button"
            onClick={action.onPerform}
          >
            {action.label}
          </button>
        )}
        <button
          className="toast__dismiss"
          type="button"
          aria-label={`Dismiss: ${title}`}
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}

export interface ToastRegionItem extends ToastContent {
  readonly id: string;
}

export interface ToastRegionProps {
  readonly toasts: readonly ToastRegionItem[];
  readonly label?: string;
  readonly placement?: ToastPlacement;
  onDismiss(id: string): void;
}

export function ToastRegion({
  toasts,
  label = "Notifications",
  placement = "viewport",
  onDismiss,
}: ToastRegionProps) {
  return (
    <div
      className={
        placement === "inline"
          ? "toast-region toast-region--inline"
          : "toast-region"
      }
      role="region"
      aria-label={label}
    >
      <ol
        className="toast-region__list"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {toasts.map(({ id, ...content }) => (
          <li className="toast-region__item" key={id}>
            <Toast {...content} onDismiss={() => onDismiss(id)} />
          </li>
        ))}
      </ol>
    </div>
  );
}
