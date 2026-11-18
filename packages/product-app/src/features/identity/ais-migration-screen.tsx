// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { HostSnapshot } from "@nilx-one/host-contract";
import { AppChrome } from "@nilx-one/ui";

import {
  HOST_LABEL_KEYS,
  translateFirst,
  useLocalization,
} from "../../shell/localization";
import type { AisMigrationFailure } from "./ais-migration";

export interface AisMigrationScreenProps {
  readonly hostLabel: string;
  readonly safeArea: HostSnapshot["safeArea"];
  /** `confirm`: aiaiaiai verified the account, the owner decides. `error`: a step did not go through. */
  readonly stage: "confirm" | "error";
  readonly reason?: AisMigrationFailure | undefined;
  readonly busy: boolean;
  onConfirm(): void;
  onBack(): void;
}

const REASON_COPY = {
  "fresh-sign-in-required": "identity.migration.failure.freshSignIn",
  "already-attached": "identity.migration.failure.alreadyAttached",
  "already-aiaiaiai": "identity.migration.failure.alreadyAiaiaiai",
  "in-progress": "identity.migration.failure.inProgress",
  expired: "identity.migration.failure.expired",
  "proof-invalid": "identity.migration.failure.proofInvalid",
  "identity-conflict": "identity.migration.failure.identityConflict",
  unavailable: "identity.migration.failure.unavailable",
} as const;

/**
 * The owner of an existing Bond decides to attach it to the aiaiaiai account
 * that was just verified. Nothing changes until the explicit confirmation.
 */
export function AisMigrationScreen({
  hostLabel,
  safeArea,
  stage,
  reason,
  busy,
  onConfirm,
  onBack,
}: AisMigrationScreenProps) {
  const { t } = useLocalization();
  return (
    <AppChrome
      copy={{
        skip: t("chrome.skip"),
        home: t("chrome.home"),
        currentHost: t("chrome.currentHost"),
      }}
      hostLabel={translateFirst(t, hostLabel, HOST_LABEL_KEYS)}
      safeArea={safeArea}
      footer={
        <>
          <span>0x1 · {t("identity.stage")}</span>
          <span>© 2026 aiaiaiai · aiaiaiai.org</span>
        </>
      }
    >
      <div className="foundation-layout">
        <section
          className="identity-panel"
          aria-labelledby="ais-migration-title"
        >
          <div className="identity-copy">
            <p className="eyebrow">{t("identity.eyebrow")}</p>
            <h1 id="ais-migration-title">{t("identity.migration.title")}</h1>
            <p className="foundation-lede">
              {stage === "confirm"
                ? t("identity.migration.confirm")
                : t("identity.migration.lede")}
            </p>
          </div>
          <div className="identity-surface">
            {stage === "error" && reason !== undefined ? (
              <p
                className="identity-status identity-status--error"
                role="alert"
              >
                {t(REASON_COPY[reason])}
              </p>
            ) : null}
            {stage === "confirm" ? (
              <button
                type="button"
                className="ais-sign-in__button"
                disabled={busy}
                onClick={onConfirm}
              >
                {t("identity.migration.confirmAction")}
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={onBack}>
              {stage === "confirm"
                ? t("identity.migration.cancel")
                : t("identity.migration.back")}
            </button>
          </div>
        </section>
      </div>
    </AppChrome>
  );
}
