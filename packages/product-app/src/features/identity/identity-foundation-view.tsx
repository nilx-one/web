// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AppChrome, PairwiseBoundary, RuntimeStatus } from "@nilx-one/ui";
import { useState, type FormEvent } from "react";

import type { IdentityFoundationViewModel } from "./identity-foundation-view-model";

export interface IdentityFoundationViewProps {
  onRegister(selection: { discriminator: string; slug: string }): void;
  viewModel: IdentityFoundationViewModel;
}

export function IdentityFoundationView({
  onRegister,
  viewModel,
}: IdentityFoundationViewProps) {
  const [discriminator, setDiscriminator] = useState("0");
  const [slug, setSlug] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onRegister({ discriminator, slug });
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
          <p className="eyebrow">The first boundary</p>
          <h1 id="foundation-title">Identity is continuity.</h1>
          <p className="foundation-lede">
            Begin with a public address. Everything that matters after it is
            proven between exactly two Bonds, one bounded interaction at a time.
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
                <label htmlFor="pub-dress-slug">Choose your pub_dress</label>
                <div className="slug-field">
                  <div className="discriminator-field">
                    <span aria-hidden="true">0x</span>
                    <select
                      aria-label="pub_dress hexadecimal discriminator"
                      value={discriminator}
                      onChange={(event) =>
                        setDiscriminator(event.currentTarget.value)
                      }
                      disabled={viewModel.registration.busy}
                    >
                      {"0123456789abcdef".split("").map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    id="pub-dress-slug"
                    name="slug"
                    value={slug}
                    minLength={2}
                    maxLength={32}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-describedby={
                      viewModel.registration.error === undefined
                        ? "pub-dress-help"
                        : "pub-dress-help pub-dress-error"
                    }
                    onChange={(event) => setSlug(event.currentTarget.value)}
                    disabled={viewModel.registration.busy}
                    required
                  />
                </div>
                <p id="pub-dress-help" className="registration-note">
                  The slug is case-sensitive and contains 2–32 characters.
                  Registration is final.
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
                <button type="submit" disabled={viewModel.registration.busy}>
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
