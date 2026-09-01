// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AppChrome, PairwiseBoundary, RuntimeStatus } from "@nilx-one/ui";
import type { PubDressSelection } from "@nilx-one/application";
import type { FormEvent } from "react";

import type {
  IdentityFoundationViewModel,
  PubDressAvailabilityViewState,
} from "./identity-foundation-view-model";

export interface IdentityFoundationViewProps {
  availability: PubDressAvailabilityViewState;
  onRegister(selection: PubDressSelection): void;
  onSelectionChange(selection: PubDressSelection): void;
  selection: PubDressSelection;
  viewModel: IdentityFoundationViewModel;
}

function AvailabilityGlyph({
  availability,
}: {
  availability: PubDressAvailabilityViewState;
}) {
  if (availability.kind === "idle") {
    return <span className="availability-glyph" aria-hidden="true" />;
  }

  return (
    <span
      className={`availability-glyph availability-glyph--${availability.kind}`}
      aria-hidden="true"
    >
      {availability.kind === "checking" ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      ) : availability.kind === "available" ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12.2 2.6 2.6L16.4 9" />
        </svg>
      ) : availability.kind === "unavailable" ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6m0-6-6 6" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.8v5.3m0 3.1h.01" />
        </svg>
      )}
    </span>
  );
}

function availabilityDetail(
  availability: PubDressAvailabilityViewState,
): string {
  switch (availability.kind) {
    case "idle":
      return "Case-sensitive · 2–32 characters";
    case "checking":
      return "Checking availability…";
    default:
      return availability.detail;
  }
}

export function IdentityFoundationView({
  availability,
  onRegister,
  onSelectionChange,
  selection,
  viewModel,
}: IdentityFoundationViewProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onRegister(selection);
  }

  return (
    <AppChrome
      hostLabel={viewModel.hostLabel}
      safeArea={viewModel.safeArea}
      footer={
        <>
          <span>0x1 · pre-alpha</span>
          <span>© 2026 aiaiaiai · aiaiaiai.org</span>
        </>
      }
    >
      <div className="foundation-layout">
        <section className="foundation-copy" aria-labelledby="foundation-title">
          <p className="eyebrow">Your public identity</p>
          <h1 id="foundation-title">Choose your pub_dress.</h1>
          <p className="foundation-lede">
            One permanent, case-sensitive address for your identity in 0x1.
          </p>
          <section
            className="registration-surface"
            aria-label="pub_dress registration"
          >
            {viewModel.registration.kind === "registered" ? (
              <div className="registered-address" aria-live="polite">
                <span className="address-kind">Your pub_dress</span>
                <strong className="address-value">
                  {viewModel.registration.pubDress}
                </strong>
                <span className="registration-note">
                  This address is registered and cannot be renamed in place.
                </span>
              </div>
            ) : viewModel.registration.kind === "form" ? (
              <form className="registration-form" onSubmit={submit}>
                <label className="registration-label" htmlFor="pub-dress-slug">
                  Choose your pub_dress
                </label>
                <div
                  className="pub-dress-field"
                  data-availability={availability.kind}
                >
                  <span className="pub-dress-prefix" aria-hidden="true">
                    0x
                  </span>
                  <label className="discriminator-selector">
                    <span className="visually-hidden">
                      pub_dress hexadecimal discriminator
                    </span>
                    <select
                      value={selection.discriminator}
                      onChange={(event) =>
                        onSelectionChange({
                          ...selection,
                          discriminator: event.currentTarget.value,
                        })
                      }
                      disabled={viewModel.registration.busy}
                    >
                      {"0123456789abcdef".split("").map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <svg
                      className="selector-chevron"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                    >
                      <path d="m2.5 4.5 3.5 3 3.5-3" />
                    </svg>
                  </label>
                  <input
                    id="pub-dress-slug"
                    name="slug"
                    value={selection.slug}
                    minLength={2}
                    maxLength={32}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="slug"
                    aria-describedby={
                      viewModel.registration.error === undefined
                        ? "pub-dress-availability"
                        : "pub-dress-availability pub-dress-error"
                    }
                    onChange={(event) =>
                      onSelectionChange({
                        ...selection,
                        slug: event.currentTarget.value,
                      })
                    }
                    disabled={viewModel.registration.busy}
                    required
                  />
                  <AvailabilityGlyph availability={availability} />
                </div>
                <p
                  id="pub-dress-availability"
                  className={`availability-detail availability-detail--${availability.kind}`}
                  aria-live="polite"
                >
                  {availabilityDetail(availability)}
                </p>
                {viewModel.registration.error === undefined ? null : (
                  <p
                    id="pub-dress-error"
                    className="registration-error"
                    role="alert"
                  >
                    {viewModel.registration.error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={
                    viewModel.registration.busy ||
                    availability.kind !== "available"
                  }
                >
                  {viewModel.registration.busy
                    ? "Registering…"
                    : "Register pub_dress"}
                </button>
              </form>
            ) : (
              <div className="registration-message" aria-live="polite">
                <span className="address-kind">pub_dress</span>
                <p>{viewModel.registration.detail}</p>
              </div>
            )}
          </section>
          <RuntimeStatus {...viewModel.runtime} />
        </section>
        <PairwiseBoundary />
      </div>
    </AppChrome>
  );
}
