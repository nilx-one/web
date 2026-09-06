// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import "./app-shell.css";
import type { ShellPresentation } from "./shell-presentation";
import { ToastViewport } from "./toast-viewport";

export interface ShellSafeArea {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface AppShellProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly presentation: ShellPresentation;
  readonly safeArea: ShellSafeArea;
  /** The persistent spatial surface every overlay floats above. */
  readonly world: ReactNode;
  readonly header: ReactNode;
  /** The bottom-anchored contextual surface. It grows upward, never downward. */
  readonly dock: ReactNode;
  readonly toasts?: ReactNode;
  /** Low-frequency system status. Compact by contract, never a toast. */
  readonly statusRail?: ReactNode;
  /** Transient menus, popovers and announcements above every other layer. */
  readonly overlay?: ReactNode;
}

/**
 * The viewport root. Header, toast stack and Dock are independent overlay
 * layers anchored to the viewport; the world persists behind all of them at
 * every supported size.
 */
export function AppShell({
  presentation,
  safeArea,
  world,
  header,
  dock,
  toasts,
  statusRail,
  overlay,
  className,
  style,
  ...rest
}: AppShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // The toast stack must never reach the bottom layer, and only that layer
  // knows how tall it currently is. Publishing its height keeps the stack's
  // ceiling exact instead of guessing a reserve.
  useEffect(() => {
    const shell = shellRef.current;
    const bottomLayer = bottomRef.current;
    if (
      shell === null ||
      bottomLayer === null ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const publish = () =>
      shell.style.setProperty(
        "--shell-bottom-height",
        `${Math.ceil(bottomLayer.getBoundingClientRect().height)}px`,
      );

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bottomLayer);
    return () => observer.disconnect();
  }, []);

  const shellStyle = {
    "--safe-top": `${safeArea.top}px`,
    "--safe-right": `${safeArea.right}px`,
    "--safe-bottom": `${safeArea.bottom}px`,
    "--safe-left": `${safeArea.left}px`,
    ...style,
  } as CSSProperties;

  return (
    <div
      className={
        className === undefined ? "app-shell" : `app-shell ${className}`
      }
      ref={shellRef}
      data-presentation={presentation}
      style={shellStyle}
      {...rest}
    >
      <div className="app-shell__world">{world}</div>
      <div className="app-shell__header">{header}</div>
      <ToastViewport>{toasts}</ToastViewport>
      <div className="app-shell__bottom" ref={bottomRef}>
        <div className="app-shell__dock">{dock}</div>
        {statusRail === undefined ? null : (
          <div className="app-shell__status">{statusRail}</div>
        )}
      </div>
      {overlay === undefined ? null : (
        <div className="app-shell__overlay">{overlay}</div>
      )}
    </div>
  );
}
