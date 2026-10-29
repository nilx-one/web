// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { ReactNode } from "react";

import { useLocalization, type Translate } from "../../shell/localization";
import type { LevelStanding } from "../progression/progression";
import { SubscriptionIdentity } from "../subscription/subscription-status";

/** A standing as every Bond screen words it: level, experience, next level. */
export function levelSummary(t: Translate, standing: LevelStanding): string {
  return t("progression.summaryNext")
    .replace("{level}", String(standing.level))
    .replace("{xp}", String(standing.xp))
    .replace("{next}", String(standing.nextLevelXp));
}

/** The Avaia a Bond owns, as its main screen names it. */
export interface BondProfileAvaia {
  readonly pubDress: string;
  readonly level: string;
  /** Opens the Avaia's own screen; absent, the row only names it. */
  readonly onOpen?: () => void;
}

export interface BondProfileSummaryProps {
  readonly pubDress: string;
  /** The allocated public address, already checked by the caller. */
  readonly publicUrl?: string | undefined;
  /**
   * Where following that address goes, when it carries more than the
   * address itself, such as the world's camera. Absent, the address.
   */
  readonly publicHref?: string | undefined;
  /** The Bond's own standing, already worded. */
  readonly bond: string;
  readonly avaia?: BondProfileAvaia | undefined;
  /** The body's study, already worded. */
  readonly model?: string | undefined;
  readonly providers?: ReactNode;
}

/**
 * The main screen of a Bond: what it is, read. Nothing here changes anything —
 * changing is a mode the screen's header enters, so a person reading their
 * own Bond and a person reading someone else's see the same thing.
 */
export function BondProfileSummary({
  pubDress,
  publicUrl,
  publicHref,
  bond,
  avaia,
  model,
  providers,
}: BondProfileSummaryProps): React.ReactElement {
  const { t } = useLocalization();
  return (
    <div className="bond-profile bond-profile--summary">
      <SubscriptionIdentity address={pubDress} badge />
      {publicUrl === undefined ? null : (
        // The public page is the same world under another address, and its
        // way back returns here, so it opens in place rather than beside.
        <a
          className="bond-dock__public-url"
          href={publicHref ?? publicUrl}
          rel="noopener"
        >
          {publicUrl.replace(/^https:\/\//, "").replace(/\/?$/, "/")}
          <span aria-hidden="true"> ↗</span>
        </a>
      )}
      <dl className="bond-profile__rows">
        <div>
          <dt>Bond</dt>
          <dd>{bond}</dd>
        </div>
        {avaia === undefined ? null : (
          <div>
            <dt>Avaia</dt>
            <dd>
              {avaia.onOpen === undefined ? (
                <span className="bond-profile__avaia">
                  <strong>{avaia.pubDress}</strong>
                  <small>{avaia.level}</small>
                </span>
              ) : (
                <button
                  className="bond-profile__avaia"
                  type="button"
                  aria-label={t("dock.openAvaia").replace(
                    "{name}",
                    avaia.pubDress,
                  )}
                  onClick={avaia.onOpen}
                >
                  <strong>{avaia.pubDress}</strong>
                  <small>{avaia.level}</small>
                  <span aria-hidden="true">›</span>
                </button>
              )}
            </dd>
          </div>
        )}
        {model === undefined ? null : (
          <div>
            <dt>{t("dock.threeDModel")}</dt>
            <dd>{model}</dd>
          </div>
        )}
        {providers === undefined ? null : (
          <div>
            <dt>{t("dock.providers")}</dt>
            <dd>{providers}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
