// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AppChrome, PairwiseBoundary, RuntimeStatus } from "@nilx-one/ui";

import type { IdentityFoundationViewModel } from "./identity-foundation-view-model";

export interface IdentityFoundationViewProps {
  viewModel: IdentityFoundationViewModel;
}

export function IdentityFoundationView({
  viewModel,
}: IdentityFoundationViewProps) {
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
          <div className="address-preview" aria-label="pub_dress preview">
            <span className="address-kind">pub_dress</span>
            <span className="address-value">0x____</span>
          </div>
          <RuntimeStatus {...viewModel.runtime} />
        </section>
        <PairwiseBoundary />
      </div>
    </AppChrome>
  );
}
