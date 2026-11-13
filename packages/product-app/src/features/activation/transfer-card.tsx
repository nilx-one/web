// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useId, type ReactNode } from "react";

import type {
  ActivationRequestView,
  ActivationStep,
  ActivationStepView,
} from "@nilx-one/application";

import type { Translate, TranslationKey } from "../../shell/localization";
import "./transfer-card.css";

const STEP_KEYS: Readonly<Record<ActivationStep, TranslationKey>> = {
  confirm: "activation.step.confirm",
  sync: "activation.step.sync",
  switch: "activation.step.switch",
};

const RING_RADIUS = 42;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** The step to announce: the one under way, else the last one finished. */
function announcedStep(
  steps: readonly ActivationStepView[],
): ActivationStepView | undefined {
  return (
    steps.find((step) => step.state === "current") ??
    steps.findLast((step) => step.state === "done")
  );
}

function XpingMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path
        d="M7 8v8M10.5 6v12M14 6v12M17.5 8v8"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeviceGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect
        x="9"
        y="6"
        width="30"
        height="36"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <path
        d="M20 36h8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StepMark({ state }: Pick<ActivationStepView, "state">) {
  return (
    <span
      className="activation-card__mark"
      data-state={state}
      aria-hidden="true"
    >
      {state === "done" ? (
        <svg viewBox="0 0 20 20" focusable="false">
          <path
            d="M5.5 10.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

export interface TransferCardProps {
  readonly request: ActivationRequestView;
  readonly t: Translate;
  /** A short line under the progress, such as why the game is paused. */
  readonly note?: string;
  readonly actions?: ReactNode;
}

/**
 * The shared picture of a handoff. Every step, mark, label and the
 * percentage come from Core's request; the card draws them as given, even
 * when the percentage goes down.
 */
export function TransferCard({ request, t, note, actions }: TransferCardProps) {
  const titleId = useId();
  const progress = request.progress;
  const steps = progress?.steps ?? [];
  const confirmed = steps.some(
    (step) => step.step === "confirm" && step.state === "done",
  );
  const announced = announcedStep(steps);

  return (
    <section
      className="activation-card"
      aria-labelledby={titleId}
      data-status={request.status}
    >
      <div className="activation-card__panel">
        <p className="activation-card__brand">
          <XpingMark />
          <span>xPing</span>
        </p>
        <h2 className="activation-card__title" id={titleId}>
          {t("activation.card.title")}
        </h2>
        {steps.length === 0 ? null : (
          <ol className="activation-card__steps">
            {steps.map((step) => (
              <li
                className="activation-card__step"
                data-state={step.state}
                key={step.step}
                aria-current={step.state === "current" ? "step" : undefined}
              >
                <StepMark state={step.state} />
                <span>{t(STEP_KEYS[step.step])}</span>
                <span className="visually-hidden">
                  {`, ${t(`activation.stepState.${step.state}`)}`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="activation-card__route">
        <div className="activation-card__device" data-side="from">
          <span className="activation-card__glyph">
            <DeviceGlyph />
            {confirmed ? (
              <span className="activation-card__badge" aria-hidden="true">
                <StepMark state="done" />
              </span>
            ) : null}
          </span>
          <span className="activation-card__caption">
            {t("activation.from")}
            <strong>{request.fromLabel}</strong>
          </span>
        </div>
        <span className="activation-card__chevrons" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <div className="activation-card__device" data-side="to">
          <span className="activation-card__glyph">
            <DeviceGlyph />
          </span>
          <span className="activation-card__caption">
            {t("activation.to")}
            <strong>{request.toLabel}</strong>
          </span>
        </div>
      </div>

      {progress === undefined ? null : (
        <div
          className="activation-card__ring"
          role="progressbar"
          aria-label={t("activation.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <circle
              className="activation-card__ring-track"
              cx="50"
              cy="50"
              r={RING_RADIUS}
            />
            <circle
              className="activation-card__ring-value"
              cx="50"
              cy="50"
              r={RING_RADIUS}
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - progress.percent / 100)}
            />
          </svg>
          <span className="activation-card__percent" aria-hidden="true">
            {`${progress.percent}%`}
          </span>
        </div>
      )}

      <p className="visually-hidden" aria-live="polite">
        {announced === undefined || progress === undefined
          ? ""
          : t("activation.announce")
              .replace("{step}", t(STEP_KEYS[announced.step]))
              .replace("{percent}", String(progress.percent))}
      </p>

      {note === undefined ? null : (
        <p className="activation-card__note">{note}</p>
      )}
      {actions === undefined ? null : (
        <div className="activation-card__actions">{actions}</div>
      )}
    </section>
  );
}
