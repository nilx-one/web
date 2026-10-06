// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreEconomyCatalog, CoreHolder } from "@nilx-one/application";
import { useState } from "react";

import { useLocalization } from "../../shell/localization";
import { CraftSection } from "./craft-section";
import "./inventory-panel.css";
import {
  applyInventory,
  useInventory,
  type CarriedGrid,
  type InventoryPort,
  type PlacedThing,
} from "./inventory";
import { thingName } from "./thing-name";

export interface InventoryPanelProps {
  readonly owner: string;
  readonly core: InventoryPort;
  /** Whether experience goes through committed awards on this host. */
  readonly committed: boolean;
}

const GRIDS: Readonly<
  Record<CarriedGrid["carry"], { width: number; height: number }>
> = {
  pocket: { width: 5, height: 1 },
  backpack: { width: 8, height: 5 },
  bag: { width: 12, height: 10 },
};

function sizeOf(catalog: CoreEconomyCatalog | undefined, id: string) {
  const sized =
    catalog?.found.find((item) => item.id === id)?.size ??
    catalog?.crafted.find((item) => item.id === id)?.size;
  return sized ?? { width: 1, height: 1 };
}

function priceOf(
  catalog: CoreEconomyCatalog | undefined,
  id: string,
): number | null | undefined {
  const found = catalog?.found.find((item) => item.id === id);
  if (found !== undefined) return found.sellPrice;
  return catalog?.crafted.find((item) => item.id === id)?.sellPrice;
}

interface Selection {
  readonly holder: CoreHolder;
  readonly thing: PlacedThing;
}

/**
 * What the Bond and its Avaia carry, and the Seeds ₴€£. Tap a thing to sell
 * it or hand it across. Every rule is Core's; a refused change says so and
 * leaves everything where it was.
 */
export function InventoryPanel({
  owner,
  core,
  committed,
}: InventoryPanelProps) {
  const { t } = useLocalization();
  const { model, catalog } = useInventory(owner, core);
  const [selected, setSelected] = useState<Selection | undefined>();
  const [note, setNote] = useState<string | undefined>();

  const carryGrid = (carry: CarriedGrid["carry"]) =>
    catalog?.carries.find((candidate) => candidate.id === carry) ??
    GRIDS[carry];

  async function run(
    command: Parameters<typeof applyInventory>[2],
    done?: (gained: number) => string,
  ): Promise<void> {
    const answer = await applyInventory(owner, core, command).catch(() => ({
      ok: false as const,
      error: "generic",
    }));
    setSelected(undefined);
    if (answer.ok) {
      setNote(done?.(answer.seedsGained));
      return;
    }
    setNote(
      answer.error === "no_room"
        ? t("inventory.error.no_room")
        : t("inventory.error.generic"),
    );
  }

  function holderGrid(holder: CoreHolder, carried: CarriedGrid) {
    const { width, height } = carryGrid(carried.carry);
    const cells = Array.from({ length: width * height }, (_, index) => index);
    return (
      <section
        className="inventory__holder"
        data-holder={holder}
        aria-label={t(holder === "bond" ? "inventory.bond" : "inventory.avaia")}
      >
        <div className="inventory__holder-title">
          <strong>
            {t(holder === "bond" ? "inventory.bond" : "inventory.avaia")}
          </strong>
          <small>{t(`inventory.carry.${carried.carry}`)}</small>
        </div>
        <div className="inventory__grid-scroll">
          <div
            className="inventory__grid"
            style={{
              gridTemplateColumns: `repeat(${width}, var(--inventory-cell))`,
            }}
          >
            {cells.map((index) => (
              <span
                key={`cell-${index}`}
                className="inventory__cell"
                style={{
                  gridColumn: (index % width) + 1,
                  gridRow: Math.floor(index / width) + 1,
                }}
                aria-hidden="true"
              />
            ))}
            {carried.things.map((thing) => {
              const size = sizeOf(catalog, thing.id);
              const pressed =
                selected?.holder === holder &&
                selected.thing.x === thing.x &&
                selected.thing.y === thing.y;
              return (
                <button
                  key={`${thing.x}:${thing.y}`}
                  type="button"
                  className="inventory__thing"
                  aria-pressed={pressed}
                  style={{
                    gridColumn: `${thing.x + 1} / span ${size.width}`,
                    gridRow: `${thing.y + 1} / span ${size.height}`,
                  }}
                  onClick={() => {
                    setNote(undefined);
                    setSelected(pressed ? undefined : { holder, thing });
                  }}
                >
                  {thingName(t, thing.id)}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  const price =
    selected === undefined ? undefined : priceOf(catalog, selected.thing.id);
  const empty =
    model.bond.things.length === 0 && model.avaia.things.length === 0;

  return (
    <div className="inventory">
      <p className="inventory__seeds" role="status">
        {t("inventory.seeds").replace("{amount}", String(model.seeds))}
      </p>
      {empty ? (
        <p className="profile-edit__note">{t("inventory.empty")}</p>
      ) : null}
      {holderGrid("bond", model.bond)}
      {holderGrid("avaia", model.avaia)}
      {selected === undefined ? null : (
        <div className="inventory__actions">
          <strong>{thingName(t, selected.thing.id)}</strong>
          {selected.holder === "bond" ? (
            typeof price === "number" ? (
              <button
                type="button"
                onClick={() =>
                  void run(
                    { op: "sell", id: selected.thing.id, count: 1 },
                    (gained) =>
                      t("inventory.sold").replace("{amount}", String(gained)),
                  )
                }
              >
                {t("inventory.sell").replace("{price}", String(price))}
              </button>
            ) : (
              <small>{t("inventory.notForSale")}</small>
            )
          ) : null}
          <button
            type="button"
            onClick={() =>
              void run({
                op: "hand_over",
                from: selected.holder,
                x: selected.thing.x,
                y: selected.thing.y,
              })
            }
          >
            {t(
              selected.holder === "bond"
                ? "inventory.handToAvaia"
                : "inventory.takeFromAvaia",
            )}
          </button>
        </div>
      )}
      {note === undefined ? null : (
        <p className="profile-edit__note" role="status">
          {note}
        </p>
      )}
      <CraftSection
        owner={owner}
        core={core}
        model={model}
        catalog={catalog}
        committed={committed}
      />
    </div>
  );
}
