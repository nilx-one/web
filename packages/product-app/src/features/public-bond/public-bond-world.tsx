// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AVATAR_CATALOG } from "@nilx-one/application";
import {
  AVATAR_MODEL_IDS,
  MAP_SCALE_ZOOM,
  type AvatarModelId,
  type MapAppearance,
  type MapRenderer,
} from "@nilx-one/map-contract";
import { useEffect, useRef, useState } from "react";

import { AppShell } from "../../shell/app-shell";
import { DockWindow } from "../../shell/dock-window";
import { translateCopy, useLocalization } from "../../shell/localization";
import { useShellPresentation } from "../../shell/shell-presentation";
import {
  BondProfileSummary,
  levelSummary,
} from "../identity/bond-profile-summary";
import {
  standingForPublishedExperience,
  type ProgressionStanding,
} from "../progression/progression";
import { SubscriptionIdentity } from "../subscription/subscription-status";
import "../map/authenticated-map-home-view.css";
import "../map/authenticated-map-settings.css";
import "./public-bond-world.css";

/** What a Bond publishes about itself, as its public page reads it. */
export interface PublicBondWorldBond {
  readonly pubDress: string;
  readonly publicUrl: string;
  readonly experience: { readonly bondXp: number; readonly avaiaXp: number };
  readonly avaia?: {
    readonly pubDress: string;
    readonly configured: boolean;
    /** The study the owner chose, as stored; drawn only when known here. */
    readonly avatarModel?: string;
    /** The owner-published location, never a live position. */
    readonly location?: {
      readonly longitude: number;
      readonly latitude: number;
    };
  };
}

/** Which screen of the public Bond is open; the address decides it. */
export type PublicBondScreen = "bond" | "avaia" | "missing";

export interface PublicBondWorldProps {
  readonly renderer: MapRenderer;
  readonly appearance: MapAppearance;
  readonly bond: PublicBondWorldBond;
  readonly screen: PublicBondScreen;
  /** The way back: into the game from the Bond, to the Bond from below it. */
  readonly onBack: () => void;
  readonly onOpenAvaia: () => void;
}

const PUBLIC_AVAIA_BODY = "public-avaia";

function knownModel(model: string | undefined): AvatarModelId | undefined {
  return AVATAR_MODEL_IDS.find((id) => id === model);
}

function modelName(model: string | undefined): string | undefined {
  if (model === undefined) return undefined;
  return AVATAR_CATALOG.find((entry) => entry.id === model)?.name ?? model;
}

function PublicWorldMap({
  renderer,
  appearance,
  bond,
  screen,
}: Pick<PublicBondWorldProps, "renderer" | "appearance" | "bond" | "screen">) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState(() => renderer.getStatus());
  const { t } = useLocalization();
  useEffect(() => renderer.subscribe(setStatus), [renderer]);
  useEffect(() => {
    if (container.current === null) return;
    renderer.mount(container.current);
    return () => renderer.unmount();
  }, [renderer]);
  useEffect(() => renderer.setAppearance(appearance), [renderer, appearance]);

  // The Avaia stands where its owner published it, in the body it was given.
  // Nothing else is drawn: a public page knows of no one's live position.
  const location = bond.avaia?.location;
  const model = knownModel(bond.avaia?.avatarModel);
  const ready = status.kind === "ready";
  useEffect(() => {
    const avatars = renderer.avatars;
    if (avatars === undefined || !ready) return;
    if (location === undefined || model === undefined) return;
    avatars.upsert({
      id: PUBLIC_AVAIA_BODY,
      modelId: model,
      lngLat: [location.longitude, location.latitude],
      bearingDeg: 0,
      clipId: "idle",
      clipPhase: 0,
      scale: 1,
      visible: true,
    });
    return () => avatars.remove(PUBLIC_AVAIA_BODY);
  }, [renderer, ready, location, model]);

  // Opening the Avaia brings the world to where it stands.
  useEffect(() => {
    if (screen !== "avaia" || location === undefined) return;
    const camera = renderer.getCamera();
    renderer.setCamera(
      {
        ...camera,
        center: [location.longitude, location.latitude],
        zoom: Math.max(camera.zoom, MAP_SCALE_ZOOM.street),
      },
      { motion: "eased" },
    );
  }, [renderer, screen, location]);

  return (
    <div className="authenticated-map-home__map" aria-hidden="true">
      <div
        className="authenticated-map-home__map-host"
        ref={container}
        style={{ width: "100%", height: "100%" }}
      />
      {status.kind === "unavailable" ? (
        <p className="public-bond-world__status" role="status">
          {t("public.unavailable")}
        </p>
      ) : null}
    </div>
  );
}

function AvaiaScreen({
  bond,
  standing,
}: {
  readonly bond: PublicBondWorldBond;
  readonly standing: ProgressionStanding;
}) {
  const { t } = useLocalization();
  const avaia = bond.avaia;
  if (avaia === undefined) return null;
  const name = modelName(avaia.avatarModel);
  return (
    <div className="bond-profile bond-profile--summary">
      <SubscriptionIdentity address={avaia.pubDress} badge />
      <dl className="bond-profile__rows">
        <div>
          <dt>Avaia</dt>
          <dd>{levelSummary(t, standing.avaia)}</dd>
        </div>
        <div>
          <dt>Bond</dt>
          <dd>{bond.pubDress}</dd>
        </div>
        {name === undefined ? null : (
          <div>
            <dt>{t("dock.threeDModel")}</dt>
            <dd>{translateCopy(t, name)}</dd>
          </div>
        )}
        {avaia.location === undefined ? null : (
          <div>
            <dt>{t("public.location")}</dt>
            <dd>
              {avaia.location.latitude.toFixed(4)},{" "}
              {avaia.location.longitude.toFixed(4)}
            </dd>
          </div>
        )}
      </dl>
      <p className="profile-edit__note">{t("public.experience.reported")}</p>
    </div>
  );
}

/**
 * A Bond's public address is the same world the game draws, under the Dock
 * the game reads a Bond with: its main screen, and its Avaia one level down.
 * It never starts a session, an Avaia runtime or a position: it reads what
 * the Bond published and draws that, nothing more.
 */
export function PublicBondWorld({
  renderer,
  appearance,
  bond,
  screen,
  onBack,
  onOpenAvaia,
}: PublicBondWorldProps) {
  const presentation = useShellPresentation();
  const { t } = useLocalization();
  const standing = standingForPublishedExperience(bond.experience, {
    avaiaConfigured: bond.avaia?.configured === true,
  });
  const avaia = bond.avaia;
  const title =
    screen === "avaia" && avaia !== undefined ? avaia.pubDress : bond.pubDress;
  return (
    <AppShell
      className="authenticated-map-home public-bond-world"
      data-theme={appearance}
      data-section="identity"
      presentation={presentation}
      safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      world={
        <PublicWorldMap
          renderer={renderer}
          appearance={appearance}
          bond={bond}
          screen={screen}
        />
      }
      header={null}
      dock={
        <section className="bond-dock" data-screen={screen} aria-label={title}>
          <DockWindow screen={screen} depth={screen === "bond" ? 1 : 2}>
            <div className="bond-dock__detail">
              <div className="bond-dock__detail-header">
                <button
                  className="interface-settings__back"
                  type="button"
                  aria-label={t("settings.back")}
                  onClick={onBack}
                >
                  <span aria-hidden="true">←</span>
                </button>
                <div>
                  <span className="interface-settings__eyebrow">
                    {screen === "bond" ? "Bond" : "Avaia"}
                  </span>
                  <h2>
                    <span className="bond-dock__detail-header-title">
                      <SubscriptionIdentity address={title} badge />
                    </span>
                  </h2>
                </div>
              </div>
              <div className="bond-dock__scroll">
                {screen === "bond" ? (
                  <BondProfileSummary
                    pubDress={bond.pubDress}
                    publicUrl={bond.publicUrl}
                    bond={levelSummary(t, standing.bond)}
                    avaia={
                      avaia === undefined
                        ? undefined
                        : {
                            pubDress: avaia.pubDress,
                            level: levelSummary(t, standing.avaia),
                            onOpen: onOpenAvaia,
                          }
                    }
                  />
                ) : screen === "avaia" ? (
                  <AvaiaScreen bond={bond} standing={standing} />
                ) : (
                  <p className="profile-edit__note" role="status">
                    {t("public.notFoundDetail")}
                  </p>
                )}
              </div>
            </div>
          </DockWindow>
        </section>
      }
    />
  );
}
