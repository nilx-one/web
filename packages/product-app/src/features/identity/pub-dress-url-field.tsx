// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  normalizePubDressUrlSuffix,
  suggestPubDressUrlSuffix,
} from "@nilx-one/application";

import {
  PUB_DRESS_URL_ZONE_LABEL,
  type PubDressUrlViewState,
} from "./pub-dress-url-view-model";

export interface PubDressUrlFieldProps {
  readonly state: PubDressUrlViewState;
  readonly busy?: boolean;
  readonly onSuffixChange: (suffix: string) => void;
}

function ShuffleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h4l8 10h4" />
      <path d="M4 17h4l3-3.6" />
      <path d="m17 4 3 3-3 3" />
      <path d="m17 14 3 3-3 3" />
    </svg>
  );
}

/**
 * The Bond's public address, shown next to the identity it is derived from.
 *
 * The stem is never editable: it is the Bond's own `pub_dress`, folded. Only
 * the distinguishing part is, and only once it is needed.
 */
export function PubDressUrlField({
  state,
  busy = false,
  onSuffixChange,
}: PubDressUrlFieldProps) {
  if (state.kind === "idle") {
    return null;
  }

  const statusId = "pub-dress-url-status";

  return (
    <section className="pub-dress-url" aria-labelledby="pub-dress-url-label">
      <span className="surface-kicker" id="pub-dress-url-label">
        public address
      </span>

      {state.kind === "unrepresentable" ? (
        <div className="address-field address-field--url" data-status="invalid">
          <span className="address-url-stem address-url-stem--empty">
            {state.pubDress}
          </span>
        </div>
      ) : state.kind === "preview" ? (
        <div
          className="address-field address-field--url"
          data-status={state.status}
          data-folded={state.folded}
        >
          <span className="address-url-stem">{state.stem}</span>
          <span className="address-url-zone" aria-hidden="true">
            {PUB_DRESS_URL_ZONE_LABEL}
          </span>
        </div>
      ) : (
        <div
          className="address-field address-field--url address-field--url-suffix"
          data-status={state.status}
          data-folded={state.folded}
        >
          {/* The fixed half. Presented as a prefix rather than a disabled input
              so it never reads as something the Bond failed to fill in. */}
          <span className="address-url-stem" aria-hidden="true">
            {state.stem}
          </span>
          <input
            id="pub-dress-url-suffix"
            className="address-url-suffix"
            type="text"
            value={state.suffix}
            inputMode="numeric"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="00"
            disabled={busy}
            aria-label={`Distinguishing part of ${state.stem}${PUB_DRESS_URL_ZONE_LABEL}`}
            aria-invalid={state.status === "invalid"}
            aria-describedby={statusId}
            onChange={(event) =>
              onSuffixChange(
                normalizePubDressUrlSuffix(event.currentTarget.value),
              )
            }
          />
          <span className="address-url-zone" aria-hidden="true">
            {PUB_DRESS_URL_ZONE_LABEL}
          </span>
          <button
            className="status-action"
            type="button"
            disabled={busy}
            aria-label="Suggest another distinguishing part"
            onClick={() => onSuffixChange(suggestPubDressUrlSuffix())}
          >
            <ShuffleGlyph />
          </button>
        </div>
      )}

      {state.kind !== "unrepresentable" && state.folded ? (
        <p className="pub-dress-url-fold">
          <span>{state.pubDress}</span>
          <span aria-hidden="true">→</span>
          <strong>{state.stem}</strong>
        </p>
      ) : null}

      <p
        id={statusId}
        className={`identity-status identity-status--${state.kind === "unrepresentable" ? "invalid" : state.status}`}
        aria-live="polite"
      >
        {state.detail}
      </p>
    </section>
  );
}
