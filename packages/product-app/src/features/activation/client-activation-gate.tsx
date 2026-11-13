// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  downloadActivationPayload,
  uploadActivationPayload,
  type ActivationPayloadPort,
  type ActivationReading,
  type ActivationRequestView,
  type ActivationSyncCore,
  type ClientActivationAccessPort,
  type ClientActivationState,
  type ClientActivationView,
} from "@nilx-one/application";

import {
  useLocalization,
  type Translate,
  type TranslationKey,
} from "../../shell/localization";
import { TransferCard } from "./transfer-card";
import "./client-activation-gate.css";

/** How often to read the state while a request is open or this client is inactive. */
const OPEN_POLL_MS = 1500;
/** How often an active client with nothing asked of it looks for a request. */
const IDLE_POLL_MS = 5000;
/** How long the finished card stays on the client that just became active. */
const COMPLETED_CARD_MS = 2400;

const NOTICES: Partial<Record<ClientActivationState, TranslationKey>> = {
  activation_rejected: "activation.notice.rejected",
  activation_objected: "activation.notice.objected",
  activation_superseded: "activation.notice.superseded",
  activation_expired: "activation.notice.expired",
  activation_interrupted: "activation.notice.interrupted",
};

function requestOpen(view: ClientActivationView): boolean {
  return (
    view.request !== null &&
    (view.request.status === "pending" ||
      view.request.status === "approved" ||
      view.request.status === "syncing")
  );
}

export interface ClientActivationGateProps {
  readonly access: ClientActivationAccessPort;
  /** Core's part and digest bindings; without them no bytes move. */
  readonly core?: ActivationSyncCore;
  /** This Bond's payload; without it no bytes move. */
  readonly payload?: ActivationPayloadPort;
  /** Starts a fresh sign-in when no client is active. */
  readonly onSignIn?: () => void;
  readonly children: ReactNode;
}

/**
 * Draws Core's client activation state over the game. `may_act` is the only
 * gate: while it is false the game below is inert and sends nothing. Until
 * Core has answered with a state (or when it never does), the game renders as
 * it would without this gate.
 */
export function ClientActivationGate({
  access,
  core,
  payload,
  onSignIn,
  children,
}: ClientActivationGateProps) {
  const { t } = useLocalization();
  const [view, setView] = useState<ClientActivationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [limited, setLimited] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [finished, setFinished] = useState<ActivationRequestView | null>(null);
  const [generation, setGeneration] = useState(0);
  const viewRef = useRef<ClientActivationView | null>(null);
  const openRequests = useRef(new Set<string>());
  const running = useRef(false);
  const uploads = useRef(new Map<string, Uint8Array>());
  const readSoon = useRef<() => void>(() => undefined);
  const unmounted = useRef(new AbortController());

  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller;
    return () => controller.abort();
  }, []);

  const apply = useCallback((reading: ActivationReading) => {
    if (reading.kind === "state") {
      const next = reading.view;
      const request = next.request;
      if (request !== null && requestOpen(next))
        openRequests.current.add(request.id);
      if (
        next.state === "authenticated_active" &&
        request?.status === "completed" &&
        openRequests.current.delete(request.id)
      )
        setFinished(request);
      viewRef.current = next;
      setView(next);
      if (next.state !== "active_elsewhere") setLimited(false);
    } else if (reading.kind === "authentication-required") {
      viewRef.current = null;
      setView(null);
    } else if (
      reading.kind === "refused" &&
      reading.reason === "activation_request_limit"
    ) {
      setLimited(true);
    }
    if (reading.kind === "refused") readSoon.current();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const reading = await access.readActivationState();
      if (cancelled) return;
      apply(reading);
      const current = viewRef.current;
      const delay =
        current !== null && (!current.mayAct || requestOpen(current))
          ? OPEN_POLL_MS
          : IDLE_POLL_MS;
      timer = setTimeout(() => void read(), delay);
    };
    readSoon.current = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void read(), 0);
    };
    void read();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      readSoon.current = () => undefined;
    };
  }, [access, apply]);

  useEffect(() => {
    const request = view?.request;
    const progress = request?.progress;
    if (
      view === null ||
      request === null ||
      request === undefined ||
      progress === undefined ||
      core === undefined ||
      payload === undefined ||
      running.current
    )
      return;
    const signal = unmounted.current.signal;
    let pass: Promise<ActivationReading> | undefined;
    if (view.state === "upload_required") {
      let bytes = uploads.current.get(request.id);
      if (bytes === undefined) {
        bytes = payload.build();
        uploads.current.set(request.id, bytes);
      }
      pass = uploadActivationPayload({
        access,
        core,
        requestId: request.id,
        payload: bytes,
        uploadedBytes: progress.uploadedBytes,
        signal,
      });
    } else if (
      view.state === "activation_syncing" &&
      progress.totalBytes !== null
    ) {
      pass = downloadActivationPayload({
        access,
        core,
        requestId: request.id,
        totalBytes: progress.totalBytes,
        payload,
        signal,
      });
    }
    if (pass === undefined) return;
    running.current = true;
    void pass
      .then((reading) => {
        if (signal.aborted) return;
        if (
          reading.kind === "state" &&
          view.state === "activation_syncing" &&
          reading.view.state === "authenticated_active"
        )
          setGeneration((value) => value + 1);
        apply(reading);
      })
      .catch(() => undefined)
      .finally(() => {
        running.current = false;
      });
  }, [access, apply, core, payload, view]);

  useEffect(() => {
    if (finished === null) return;
    const timer = setTimeout(() => setFinished(null), COMPLETED_CARD_MS);
    return () => clearTimeout(timer);
  }, [finished]);

  const act = useCallback(
    (step: () => Promise<ActivationReading>) => {
      setBusy(true);
      void step()
        .then(apply)
        .finally(() => setBusy(false));
    },
    [apply],
  );

  const frozen = view !== null && !view.mayAct;
  const overlay =
    view === null || !hasOverlay(view, finished) ? null : (
      <ActivationOverlay
        view={view}
        t={t}
        busy={busy}
        limited={limited}
        dismissed={dismissed}
        finished={finished}
        onRequest={() => act(() => access.requestActivation())}
        onCancel={(id) => act(() => access.cancelActivation(id))}
        onApprove={(id) => act(() => access.approveActivation(id))}
        onDecline={(id) => act(() => access.declineActivation(id))}
        onDismiss={setDismissed}
        {...(onSignIn === undefined ? {} : { onSignIn })}
      />
    );

  return (
    <>
      <div
        className="client-activation__world"
        key={generation}
        inert={frozen}
        aria-hidden={frozen ? true : undefined}
      >
        {children}
      </div>
      {overlay === null ? null : (
        <div className="client-activation__overlay" data-frozen={frozen}>
          {overlay}
        </div>
      )}
    </>
  );
}

interface OverlayInput {
  readonly view: ClientActivationView;
  readonly t: Translate;
  readonly busy: boolean;
  readonly limited: boolean;
  readonly dismissed: string | null;
  readonly finished: ActivationRequestView | null;
  readonly onRequest: () => void;
  readonly onCancel: (id: string) => void;
  readonly onApprove: (id: string) => void;
  readonly onDecline: (id: string) => void;
  readonly onDismiss: (id: string) => void;
  readonly onSignIn?: () => void;
}

function hasOverlay(
  view: ClientActivationView,
  finished: ActivationRequestView | null,
): boolean {
  if (view.state === "authenticated_active") return finished !== null;
  if (view.state === "approval_requested") return view.request !== null;
  return true;
}

function ActivationOverlay(input: OverlayInput) {
  const { view, t, busy } = input;
  const request = view.request;
  const notice = NOTICES[view.state];

  if (
    notice !== undefined &&
    request !== null &&
    input.dismissed !== request.id
  )
    return (
      <ActivationNotice
        title={t(notice)}
        actions={
          <>
            <button
              type="button"
              className="client-activation__button"
              data-tone="primary"
              disabled={busy}
              onClick={input.onRequest}
            >
              {t("activation.askAgain")}
            </button>
            <button
              type="button"
              className="client-activation__button"
              disabled={busy}
              onClick={() => input.onDismiss(request.id)}
            >
              {t("activation.dismiss")}
            </button>
          </>
        }
      />
    );

  switch (view.state) {
    case "authenticated_active":
      return input.finished === null ? null : (
        <TransferCard request={input.finished} t={t} />
      );
    case "approval_requested":
      return request === null ? null : (
        <ActivationNotice
          title={t("activation.approval.title").replace(
            "{device}",
            request.toLabel,
          )}
          detail={t("activation.approval.detail")}
          actions={
            <>
              <button
                type="button"
                className="client-activation__button"
                data-tone="primary"
                disabled={busy}
                onClick={() => input.onApprove(request.id)}
              >
                {t("activation.approve")}
              </button>
              <button
                type="button"
                className="client-activation__button"
                disabled={busy}
                onClick={() => input.onDecline(request.id)}
              >
                {t("activation.decline")}
              </button>
            </>
          }
        />
      );
    case "upload_required":
    case "handoff_syncing":
      return request === null ? null : (
        <TransferCard
          request={request}
          t={t}
          note={t("activation.frozen")}
          actions={
            <button
              type="button"
              className="client-activation__button"
              disabled={busy}
              onClick={() => input.onDecline(request.id)}
            >
              {t("activation.stop")}
            </button>
          }
        />
      );
    case "activation_pending":
    case "activation_approved":
    case "activation_syncing":
      return request === null ? null : (
        <TransferCard
          request={request}
          t={t}
          actions={
            <button
              type="button"
              className="client-activation__button"
              disabled={busy}
              onClick={() => input.onCancel(request.id)}
            >
              {t("activation.cancel")}
            </button>
          }
        />
      );
    case "sign_in_required":
      return (
        <ActivationNotice
          title={t("activation.signIn.title")}
          detail={t("activation.signIn.detail")}
          actions={
            input.onSignIn === undefined ? undefined : (
              <button
                type="button"
                className="client-activation__button"
                data-tone="primary"
                onClick={input.onSignIn}
              >
                {t("activation.signIn.action")}
              </button>
            )
          }
        />
      );
    default:
      return (
        <ActivationNotice
          title={t("activation.elsewhere.title").replace(
            "{device}",
            view.activeClientLabel ?? t("activation.otherDevice"),
          )}
          detail={
            input.limited
              ? t("activation.limit")
              : t("activation.elsewhere.detail")
          }
          actions={
            <button
              type="button"
              className="client-activation__button"
              data-tone="primary"
              disabled={busy}
              onClick={input.onRequest}
            >
              {t("activation.elsewhere.action")}
            </button>
          }
        />
      );
  }
}

function ActivationNotice({
  title,
  detail,
  actions,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly actions?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      className="client-activation__notice"
      role="dialog"
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{title}</h2>
      {detail === undefined ? null : <p>{detail}</p>}
      {actions === undefined ? null : (
        <div className="client-activation__actions">{actions}</div>
      )}
    </section>
  );
}
