// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  ToastRegion,
  type StatusToastItem,
  type ToastRegionItem,
  type ToastAction,
} from "@nilx-one/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "../../shell/localization";
import { useToastViewportNode } from "../../shell/toast-viewport";
import "./system-informer.css";

/** Only safe user-facing copy belongs here: never raw exceptions or credentials. */
export interface SystemNotice {
  readonly id: string;
  readonly kind: "error" | "maintenance";
  readonly action?: ToastAction;
  readonly reference?: string;
  readonly title: string;
  readonly description?: string;
  /** An explicitly announced window, not a client estimate of recovery. */
  readonly window?: { readonly startsAt: string; readonly endsAt: string };
}
interface State {
  readonly queue: readonly SystemNotice[];
  readonly results: readonly SystemNotice[];
}
type Action =
  | { type: "publish"; notice: SystemNotice }
  | { type: "finish"; id: string }
  | { type: "dismiss"; id: string };
const INITIAL: State = { queue: [], results: [] };
export function systemInformerReducer(state: State, action: Action): State {
  if (action.type === "dismiss")
    return {
      ...state,
      results: state.results.filter((notice) => notice.id !== action.id),
    };
  if (action.type === "finish") {
    const notice = state.queue[0];
    if (notice?.id !== action.id) return state;
    return { queue: state.queue.slice(1), results: [...state.results, notice] };
  }
  if (
    [...state.queue, ...state.results].some(
      (notice) => notice.id === action.notice.id,
    )
  )
    return state;
  // A burst must not force an unbounded run of movies. Every extra report is
  // still readable in the result stack, without another interruption.
  if (state.queue.length >= 8)
    return { ...state, results: [...state.results, action.notice] };
  return { ...state, queue: [...state.queue, action.notice] };
}
interface Informer {
  readonly available: boolean;
  readonly pending: boolean;
  readonly activeId: string | undefined;
  showWorld(visible: boolean): void;
  publish(notice: SystemNotice): void;
  block(token: string, active: boolean): void;
}
const NO_INFORMER: Informer = {
  available: false,
  pending: false,
  activeId: undefined,
  showWorld: () => {},
  publish: () => {},
  block: () => {},
};
const Context = createContext<Informer>(NO_INFORMER);
export function useSystemInformer(): Informer {
  return useContext(Context);
}

/** Existing story/achievement scenes finish before Ping takes the stage. */
export function useSystemInformerBlock(active: boolean): void {
  const { block } = useSystemInformer();
  const token = useId();
  useLayoutEffect(() => {
    if (!active) return;
    block(token, true);
    return () => block(token, false);
  }, [active, block, token]);
}

/** Report transitions, not renders; recovery rearms the same error for next time. */
export function useSystemErrorNotices(
  notices: readonly StatusToastItem[],
): void {
  const { publish } = useSystemInformer();
  const previous = useRef(new Set<string>());
  const sequence = useRef(0);
  const source = useId();
  useEffect(() => {
    const errors = notices.filter((notice) => notice.kind === "error");
    for (const notice of errors) {
      if (previous.current.has(notice.id)) continue;
      sequence.current += 1;
      publish({
        id: `${source}:${sequence.current}:${notice.id}`,
        kind: "error",
        title: notice.title,
        ...(notice.description === undefined
          ? {}
          : { description: notice.description }),
      });
    }
    previous.current = new Set(errors.map((notice) => notice.id));
  }, [notices, publish, source]);
}

export function maintenanceWindow(
  notice: SystemNotice,
  locale: string,
): string | undefined {
  if (notice.kind !== "maintenance" || notice.window === undefined)
    return undefined;
  const start = Date.parse(notice.window.startsAt);
  const end = Date.parse(notice.window.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return undefined;
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${format.format(start)} — ${format.format(end)}`;
}

function PingScene({
  notice,
  worldVisible,
  onFinish,
}: {
  readonly notice: SystemNotice;
  readonly worldVisible: boolean;
  onFinish(): void;
}) {
  const { t, resolved: locale } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  const window = maintenanceWindow(notice, locale);
  useEffect(() => {
    const element = dialog.current;
    const focused = document.activeElement;
    if (element?.showModal !== undefined) element.showModal();
    else element?.setAttribute("open", "");
    return () => {
      element?.close?.();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="ping-scene"
      data-world={worldVisible || undefined}
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        onFinish();
      }}
    >
      <div className="ping-scene__sky" aria-hidden="true">
        <svg className="ping-scene__drone" viewBox="0 0 320 200" fill="none">
          <ellipse
            className="ping-scene__shadow"
            cx="160"
            cy="185"
            rx="58"
            ry="7"
            fill="currentColor"
            opacity=".15"
          />
          <g stroke="currentColor" strokeWidth="4">
            <path d="m135 105-64-37m114 37 64-37M139 119l-57 24m99-24 57 24" />
            <ellipse cx="67" cy="65" rx="43" ry="11" />
            <ellipse cx="253" cy="65" rx="43" ry="11" />
            <ellipse cx="76" cy="145" rx="36" ry="9" />
            <ellipse cx="244" cy="145" rx="36" ry="9" />
            <path d="m121 87 39-18 39 18v36l-39 21-39-21Z" fill="#112b38" />
            <path d="m121 87 39 19 39-19m-39 19v38" opacity=".45" />
          </g>
          <circle cx="160" cy="111" r="10" fill="currentColor" />
          <circle cx="157" cy="108" r="3" fill="white" />
        </svg>
      </div>
      <div className="ping-scene__copy">
        <p className="ping-scene__speaker">
          {t("system.ping.name")} · {t("system.ping.role")}
        </p>
        <h2 id={title}>{notice.title}</h2>
        <div id={description}>
          <p>{notice.description}</p>
          {window === undefined ? null : (
            <p>
              {t("system.ping.window")}: {window}
            </p>
          )}
        </div>
        <div className="ping-scene__actions">
          <button type="button" onClick={onFinish}>
            {t("system.ping.done")}
          </button>
          <button className="ping-scene__skip" type="button" onClick={onFinish}>
            {t("system.ping.skip")}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function SystemInformerProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [worldVisible, showWorld] = useState(false);
  const [state, dispatch] = useReducer(systemInformerReducer, INITIAL);
  const [blocks, changeBlock] = useReducer(
    (
      current: ReadonlySet<string>,
      action: { token: string; active: boolean },
    ) => {
      const next = new Set(current);
      if (action.active) next.add(action.token);
      else next.delete(action.token);
      return next;
    },
    new Set<string>(),
  );
  const publish = useCallback(
    (notice: SystemNotice) => dispatch({ type: "publish", notice }),
    [],
  );
  const block = useCallback(
    (token: string, active: boolean) => changeBlock({ token, active }),
    [],
  );
  const activeId = blocks.size === 0 ? state.queue[0]?.id : undefined;
  const context = useMemo(
    () => ({
      available: true,
      pending: state.queue.length > 0,
      activeId,
      showWorld,
      publish,
      block,
    }),
    [state.queue.length, activeId, publish, block],
  );
  const { t, resolved: locale } = useLocalization();
  const viewport = useToastViewportNode();
  const active = blocks.size === 0 ? state.queue[0] : undefined;
  const toasts: ToastRegionItem[] = state.results.map((notice) => {
    const window = maintenanceWindow(notice, locale);
    return {
      id: notice.id,
      ...(notice.reference === undefined ? {} : { details: notice.reference }),
      ...(notice.action === undefined
        ? {}
        : {
            action: {
              label: notice.action.label,
              onPerform: () => {
                dispatch({ type: "dismiss", id: notice.id });
                notice.action?.onPerform();
              },
            },
          }),
      tone: notice.kind === "error" ? "critical" : "attention",
      title: `${t("system.ping.name")}: ${notice.title}`,
      description: [notice.description, window].filter(Boolean).join(" · "),
    };
  });
  const region = (
    <ToastRegion
      toasts={toasts}
      label={t("system.ping.role")}
      placement={viewport === undefined ? "viewport" : "inline"}
      copy={{ reference: t("toast.reference"), dismiss: t("toast.dismiss") }}
      onDismiss={(id) => dispatch({ type: "dismiss", id })}
    />
  );
  return (
    <Context.Provider value={context}>
      {children}
      {active === undefined ? null : (
        <PingScene
          key={active.id}
          notice={active}
          worldVisible={worldVisible}
          onFinish={() => dispatch({ type: "finish", id: active.id })}
        />
      )}
      {viewport === undefined ? region : createPortal(region, viewport)}
    </Context.Provider>
  );
}
