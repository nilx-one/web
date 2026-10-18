// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useEffect, useRef } from "react";
import { useLocalization } from "../../shell/localization";
import "./courier.css";
export function CourierOffer({
  busy,
  error,
  blocked,
  onAccept,
  onDecline,
}: {
  busy: boolean;
  error: boolean;
  /** Why it cannot go: its engine is broken. */
  blocked?: "broken" | undefined;
  onAccept(): void;
  onDecline(): void;
}) {
  const { t } = useLocalization();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current,
      previous = document.activeElement;
    if (el?.showModal) el.showModal();
    else el?.setAttribute("open", "");
    return () => {
      el?.close?.();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="courier-offer"
      aria-labelledby="courier-offer-title"
      onCancel={(event) => {
        event.preventDefault();
        onDecline();
      }}
    >
      <p>xPing</p>
      <h2 id="courier-offer-title">{t("courier.offer")}</h2>
      <p>{t("courier.boundary")}</p>
      {error ? (
        <p role="alert">
          {blocked === "broken"
            ? t("courier.engineBroken")
            : t("courier.unavailable")}
        </p>
      ) : null}
      <button type="button" disabled={busy} onClick={onAccept}>
        {t("courier.send")}
      </button>
      <button type="button" onClick={onDecline}>
        {t("courier.decline")}
      </button>
    </dialog>
  );
}
