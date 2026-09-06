// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ToastViewportRegistry {
  readonly node: HTMLElement | null;
  attach(node: HTMLElement | null): void;
}

const ToastViewportContext = createContext<ToastViewportRegistry | undefined>(
  undefined,
);

export interface ToastViewportProviderProps {
  readonly children: ReactNode;
}

/**
 * Publishes the single transient-notice anchor to producers mounted above the
 * shell. Toasts belong to the viewport, never to the Dock, so every producer
 * targets the same stack instead of anchoring itself.
 */
export function ToastViewportProvider({
  children,
}: ToastViewportProviderProps) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const registry = useMemo<ToastViewportRegistry>(
    () => ({ node, attach: setNode }),
    [node],
  );

  return (
    <ToastViewportContext.Provider value={registry}>
      {children}
    </ToastViewportContext.Provider>
  );
}

/**
 * The mounted toast stack, or `undefined` when no shell is on screen and a
 * producer has to anchor its own viewport-level region.
 */
export function useToastViewportNode(): HTMLElement | undefined {
  return useContext(ToastViewportContext)?.node ?? undefined;
}

export interface ToastViewportProps {
  readonly children?: ReactNode;
}

/**
 * The top-right stack below the header. It never repositions the Dock and the
 * Dock never contains it.
 */
export function ToastViewport({ children }: ToastViewportProps) {
  const attach = useContext(ToastViewportContext)?.attach;
  const registerNotices = useCallback(
    (node: HTMLDivElement | null) => {
      attach?.(node);
    },
    [attach],
  );

  return (
    <div className="app-shell__toasts">
      <div className="app-shell__notices" ref={registerNotices} />
      {children}
    </div>
  );
}
