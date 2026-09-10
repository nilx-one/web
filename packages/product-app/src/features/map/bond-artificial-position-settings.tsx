// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  parsePubDress,
  removeBondLocationOverride,
  setBondLocationOverride,
  type BondLocationOverrides,
  type WorldPosition,
} from "@nilx-one/application";
import type { MapPointSelection, MapRenderer } from "@nilx-one/map-contract";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useLocalization } from "../../shell/localization";
import {
  readBondLocationOverrides,
  writeBondLocationOverrides,
  type BondLocationOverridesReadResult,
} from "./bond-location-overrides-storage";

export interface BondArtificialPositionSettingsProps {
  readonly ownerPubDress: string;
  readonly renderer: MapRenderer;
}

function readInitialState(
  ownerPubDress: string,
): BondLocationOverridesReadResult {
  if (typeof window === "undefined") {
    return { kind: "unavailable", overrides: new Map() };
  }
  return readBondLocationOverrides(window.localStorage, ownerPubDress);
}

function positionLabel(position: WorldPosition): string {
  return `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}

function pointPosition(point: MapPointSelection): WorldPosition {
  return { longitude: point.longitude, latitude: point.latitude };
}

/**
 * Edits a disclosure override for one explicit counterpart Bond. The map is an
 * editor for the artificial point only; it never changes the device observation
 * and never creates presence, BondChain, or Relationship evidence.
 */
export function BondArtificialPositionSettings({
  ownerPubDress,
  renderer,
}: BondArtificialPositionSettingsProps) {
  const localization = useLocalization();
  const copy = useMemo(
    () =>
      localization.resolved === "uk-UA"
        ? {
            legend: "Штучна позиція",
            target: "Bond.pub_dress",
            targetPlaceholder: "0x1friend",
            targetHint: "Вкажіть Bond, лише для якого діятиме ця позиція.",
            invalidTarget: "Потрібен pub_dress іншого Bond.",
            notSelected: "Не обрано",
            tapMap: "Торкніться точки на мапі…",
            choose: "Обрати на мапі",
            replace: "Змінити на мапі",
            clear: "Очистити",
            cancel: "Скасувати",
            unavailable: "Цей renderer не підтримує вибір точки на мапі.",
            storageUnavailable:
              "Сховище недоступне: зміна діятиме лише в цій сесії.",
            corrupt:
              "Збережена політика пошкоджена. Вона не буде замінена реальною позицією.",
            reset: "Скинути пошкоджену політику",
            note: "Реальна геопозиція пристрою не змінюється. Override адресований лише вказаному Bond.",
          }
        : {
            legend: "Artificial position",
            target: "Bond.pub_dress",
            targetPlaceholder: "0x1friend",
            targetHint: "Name the Bond for which this position alone applies.",
            invalidTarget: "Enter another Bond's valid pub_dress.",
            notSelected: "Not selected",
            tapMap: "Tap a point on the map…",
            choose: "Choose on map",
            replace: "Change on map",
            clear: "Clear",
            cancel: "Cancel",
            unavailable: "This renderer cannot select a point on the map.",
            storageUnavailable:
              "Storage is unavailable: this change lasts for this session only.",
            corrupt:
              "The saved policy is corrupt. It will not fall back to the real position.",
            reset: "Reset corrupt policy",
            note: "The device's real location does not change. This override is addressed only to the named Bond.",
          },
    [localization.resolved],
  );
  const [counterpartDraft, setCounterpartDraft] = useState("");
  const [store, setStore] = useState(() => readInitialState(ownerPubDress));
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const counterpartPubDress = counterpartDraft.trim();
  const counterpartValid =
    parsePubDress(counterpartPubDress) !== undefined &&
    counterpartPubDress !== ownerPubDress;
  const overrides = store.kind === "corrupt" ? undefined : store.overrides;
  const selected =
    counterpartValid && overrides !== undefined
      ? overrides.get(counterpartPubDress)
      : undefined;
  const pickerSupported =
    renderer.subscribePointSelection !== undefined &&
    renderer.setSelectionPoint !== undefined;
  const canPick =
    counterpartValid && overrides !== undefined && pickerSupported;

  const persist = useCallback(
    (next: BondLocationOverrides): void => {
      if (typeof window === "undefined") {
        setStore({ kind: "unavailable", overrides: next });
        return;
      }
      const result = writeBondLocationOverrides(
        window.localStorage,
        ownerPubDress,
        next,
      );
      setStore(
        result === "saved"
          ? { kind: "ready", overrides: next }
          : { kind: "unavailable", overrides: next },
      );
    },
    [ownerPubDress],
  );

  useEffect(() => {
    setPicking(false);
    setError(undefined);
  }, [counterpartPubDress]);

  // A stored point is shown only while this settings surface names that Bond.
  // It is a draft/editor marker, not the renderer's observed-position marker.
  useEffect(() => {
    if (renderer.setSelectionPoint === undefined) return;
    renderer.setSelectionPoint(
      selected === undefined
        ? null
        : { longitude: selected.longitude, latitude: selected.latitude },
    );
    return () => renderer.setSelectionPoint?.(null);
  }, [renderer, selected]);

  useEffect(() => {
    if (
      !picking ||
      !counterpartValid ||
      overrides === undefined ||
      renderer.subscribePointSelection === undefined
    ) {
      return;
    }

    return renderer.subscribePointSelection((point) => {
      try {
        const next = setBondLocationOverride(
          overrides,
          counterpartPubDress,
          pointPosition(point),
        );
        persist(next);
        setPicking(false);
        setError(undefined);
      } catch {
        setError(copy.invalidTarget);
        setPicking(false);
      }
    });
  }, [
    copy.invalidTarget,
    counterpartPubDress,
    counterpartValid,
    overrides,
    persist,
    picking,
    renderer,
  ]);

  function clearPosition(): void {
    if (!counterpartValid || overrides === undefined) return;
    persist(removeBondLocationOverride(overrides, counterpartPubDress));
    setPicking(false);
    setError(undefined);
  }

  function resetCorruptPolicy(): void {
    const next: BondLocationOverrides = new Map();
    persist(next);
    setPicking(false);
    setError(undefined);
  }

  return (
    <fieldset className="interface-settings__appearance">
      <legend>{copy.legend}</legend>
      <div className="profile-edit__form">
        <label
          className="interface-settings__eyebrow"
          htmlFor="artificial-position-bond"
        >
          {copy.target}
        </label>
        <div className="profile-edit__address">
          <input
            id="artificial-position-bond"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={copy.targetPlaceholder}
            value={counterpartDraft}
            onChange={(event) => setCounterpartDraft(event.currentTarget.value)}
          />
        </div>
        <p className="profile-edit__note">
          {counterpartDraft.length > 0 && !counterpartValid
            ? copy.invalidTarget
            : copy.targetHint}
        </p>
      </div>

      {store.kind === "corrupt" ? (
        <>
          <p className="profile-edit__error" role="alert">
            {copy.corrupt}
          </p>
          <button
            className="bond-profile__action"
            type="button"
            onClick={resetCorruptPolicy}
          >
            {copy.reset}
          </button>
        </>
      ) : (
        <>
          <button
            className="bond-profile__action"
            type="button"
            disabled={!canPick}
            onClick={() => setPicking((value) => !value)}
          >
            {picking
              ? copy.tapMap
              : selected === undefined
                ? `${copy.notSelected} · ${copy.choose}`
                : `${positionLabel(selected)} · ${copy.replace}`}
          </button>
          {selected === undefined ? null : (
            <button
              className="bond-profile__action"
              type="button"
              onClick={clearPosition}
            >
              {copy.clear}
            </button>
          )}
          {picking ? (
            <button
              className="bond-profile__action"
              type="button"
              onClick={() => setPicking(false)}
            >
              {copy.cancel}
            </button>
          ) : null}
        </>
      )}

      {!pickerSupported ? (
        <p className="profile-edit__error" role="status">
          {copy.unavailable}
        </p>
      ) : null}
      {store.kind === "unavailable" ? (
        <p className="profile-edit__note">{copy.storageUnavailable}</p>
      ) : null}
      {error === undefined ? null : (
        <p className="profile-edit__error" role="alert">
          {error}
        </p>
      )}
      <p className="interface-settings__note">{copy.note}</p>
    </fieldset>
  );
}
