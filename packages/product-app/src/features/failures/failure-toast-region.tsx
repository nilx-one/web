// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createFailureNotice,
  type FailureNotice,
  type FailureReport,
} from "@nilx-one/application";
import { ToastRegion, type ToastRegionItem } from "@nilx-one/ui";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useToastViewportNode } from "../../shell/toast-viewport";

export interface PublishFailureOptions {
  /**
   * Supplied by whatever issued the failed operation. A retry affordance is
   * only rendered when the runtime marked the report retryable *and* the
   * caller can actually reissue the operation.
   */
  readonly onRetry?: () => void;
}

export type PublishFailure = (
  report: FailureReport,
  options?: PublishFailureOptions,
) => void;

interface PresentedFailure {
  readonly id: string;
  readonly notice: FailureNotice;
  readonly onRetry?: () => void;
}

const FailureNoticeContext = createContext<PublishFailure | undefined>(
  undefined,
);

function toToastItem(
  entry: PresentedFailure,
  dismiss: (id: string) => void,
): ToastRegionItem {
  const { notice, onRetry } = entry;

  return {
    id: entry.id,
    tone: notice.tone,
    title: notice.title,
    description: notice.description,
    ...(notice.reference === undefined ? {} : { details: notice.reference }),
    ...(notice.action === undefined || onRetry === undefined
      ? {}
      : {
          action: {
            label: notice.action.label,
            onPerform: () => {
              dismiss(entry.id);
              onRetry();
            },
          },
        }),
  };
}

export interface FailureNoticeProviderProps {
  readonly children: ReactNode;
}

/**
 * Mounts the single failure toast region for the whole client and exposes the
 * seam a failure producer publishes through. Notices are never dismissed on a
 * timer: a person reads them for as long as they need and closes them.
 */
export function FailureNoticeProvider({
  children,
}: FailureNoticeProviderProps) {
  const [presented, setPresented] = useState<readonly PresentedFailure[]>([]);
  const sequence = useRef(0);

  const publish = useCallback<PublishFailure>((report, options = {}) => {
    sequence.current += 1;
    const id = `failure-${sequence.current}`;

    setPresented((current) => [
      ...current,
      {
        id,
        notice: createFailureNotice(report),
        ...(options.onRetry === undefined ? {} : { onRetry: options.onRetry }),
      },
    ]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setPresented((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toasts = useMemo(
    () => presented.map((entry) => toToastItem(entry, dismiss)),
    [presented, dismiss],
  );

  return (
    <FailureNoticeContext.Provider value={publish}>
      {children}
      <FailureToastRegion toasts={toasts} onDismiss={dismiss} />
    </FailureNoticeContext.Provider>
  );
}

interface FailureToastRegionProps {
  readonly toasts: readonly ToastRegionItem[];
  onDismiss(id: string): void;
}

/**
 * Notices join the shell's single toast stack whenever a shell is mounted, so
 * transient feedback never opens a second competing column. Without a shell —
 * the pre-authentication surface — the region anchors itself.
 */
function FailureToastRegion({ toasts, onDismiss }: FailureToastRegionProps) {
  const viewport = useToastViewportNode();
  const region = (
    <ToastRegion
      toasts={toasts}
      label="Failure notices"
      placement={viewport === undefined ? "viewport" : "inline"}
      onDismiss={onDismiss}
    />
  );

  return viewport === undefined ? region : createPortal(region, viewport);
}

/**
 * The seam a failure producer calls once one exists upstream. Nothing in the
 * client publishes failures today.
 */
export function usePublishFailure(): PublishFailure {
  const publish = useContext(FailureNoticeContext);

  if (publish === undefined) {
    throw new Error(
      "usePublishFailure requires a FailureNoticeProvider ancestor",
    );
  }

  return publish;
}
