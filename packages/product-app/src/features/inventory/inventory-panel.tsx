// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreEconomyCatalog, CoreHolder } from "@nilx-one/application";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

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
import { ThingIcon } from "./thing-icon";
import { thingName } from "./thing-name";

export interface InventoryPanelProps {
  readonly owner: string;
  readonly core: InventoryPort;
  /** Whether experience goes through committed awards on this host. */
  readonly committed: boolean;
  /** The repair workshop this device stands at, if any. */
  readonly workshop?: { readonly name?: string | undefined } | undefined;
  /**
   * Buying carries and crafting. Off for now: carries will change only at
   * home, and both come back together later.
   */
  readonly shopAndCraft?: boolean;
  /** Whose grid is shown, and first: the one the screen was opened for. */
  readonly first?: CoreHolder | undefined;
  /**
   * Whether the Bond and its Avaia stand together (Core's `near` proximity
   * level). Only then is the other's grid shown and can things change hands;
   * apart, or when nothing says where either is, each sees only its own.
   */
  readonly together?: boolean;
}

const GRIDS: Readonly<
  Record<CarriedGrid["carry"], { width: number; height: number }>
> = {
  pocket: { width: 1, height: 3 },
  backpack: { width: 3, height: 4 },
  bag: { width: 12, height: 10 },
};

function sizeOf(catalog: CoreEconomyCatalog | undefined, id: string) {
  const sized =
    catalog?.found.find((item) => item.id === id)?.size ??
    catalog?.crafted.find((item) => item.id === id)?.size;
  return sized ?? undefined;
}

function priceOf(
  catalog: CoreEconomyCatalog | undefined,
  id: string,
): number | null | undefined {
  const found = catalog?.found.find((item) => item.id === id);
  if (found !== undefined) return found.sellPrice;
  return catalog?.crafted.find((item) => item.id === id)?.sellPrice;
}

/** The cell-count message for a plural category; "two" and "zero" read as "other". */
function cellsForm(category: Intl.LDMLPluralRule) {
  return category === "one" || category === "few" || category === "many"
    ? category
    : "other";
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
  workshop,
  first = "bond",
  shopAndCraft = false,
  together = false,
}: InventoryPanelProps) {
  const { t, resolved } = useLocalization();
  const plural = new Intl.PluralRules(resolved);
  const { model, catalog } = useInventory(owner, core);
  const inventoryId = useId();
  const [selected, setSelected] = useState<Selection | undefined>();
  const detailsRef = useRef<HTMLDivElement>(null);
  const selectedButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    detailsRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const [note, setNote] = useState<string | undefined>();

  // Walking apart closes whatever was open on the other's grid.
  const [wasTogether, setWasTogether] = useState(together);
  if (wasTogether !== together) {
    setWasTogether(together);
    if (!together && selected !== undefined && selected.holder !== first) {
      setSelected(undefined);
    }
  }

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
        : answer.error === "too_big"
          ? t("inventory.error.too_big")
          : answer.error === "not_enough_seeds"
            ? t("craft.error.not_enough_seeds")
            : t("inventory.error.generic"),
    );
  }

  function holderGrid(holder: CoreHolder, carried: CarriedGrid) {
    const { width, height } = carryGrid(carried.carry);
    // Every carry sits in a backpack-sized frame, so the cards line up: a
    // smaller carry draws only its own cells, a larger one scrolls within it.
    const frame = carryGrid("backpack");
    const used = carried.things.reduce<number | undefined>((total, thing) => {
      const size = sizeOf(catalog, thing.id);
      return total === undefined || size === undefined
        ? undefined
        : total + size.width * size.height;
    }, 0);
    const occupancy = t(
      used === undefined ? "inventory.capacityUnknown" : "inventory.occupancy",
    )
      .replace("{used}", String(used))
      .replace("{total}", String(width * height));
    const carrySize = t("inventory.carrySize")
      .replace("{carry}", t(`inventory.carryTitle.${carried.carry}`))
      .replace("{width}", String(width))
      .replace("{height}", String(height));
    const cellCount = t(
      `inventory.cells.${cellsForm(plural.select(width * height))}`,
    ).replace("{count}", String(width * height));
    const cells = Array.from({ length: width * height }, (_, index) => index);
    return (
      <section
        className="inventory__holder"
        data-holder={holder}
        data-carry={carried.carry}
        aria-label={t(holder === "bond" ? "inventory.bond" : "inventory.avaia")}
      >
        <div className="inventory__holder-title">
          <div>
            <strong>
              {t(holder === "bond" ? "inventory.bond" : "inventory.avaia")}
            </strong>
            <small className="inventory__carry">
              <span>{carrySize}</span>
              <span>{cellCount}</span>
            </small>
          </div>
          <span className="inventory__capacity" aria-label={occupancy}>
            {used ?? "—"}
            <span aria-hidden="true"> / {width * height}</span>
          </span>
        </div>
        {used === undefined ? null : (
          <meter
            className="inventory__capacity-meter"
            min={0}
            max={width * height}
            value={used}
            aria-label={occupancy}
          />
        )}
        {shopAndCraft ? (
          <div className="inventory__actions">
            {(["backpack", "bag"] as const).map((carry) => {
              const name = t(`inventory.carryName.${carry}`);
              if (carried.owned.includes(carry)) {
                return carried.carry === carry ? null : (
                  <button
                    key={carry}
                    type="button"
                    onClick={() =>
                      void run({ op: "switch_carry", holder, carry })
                    }
                  >
                    {t("inventory.wear").replace("{carry}", name)}
                  </button>
                );
              }
              const price = catalog?.carries.find(
                (candidate) => candidate.id === carry,
              )?.price;
              return price === undefined || price === null ? null : (
                <button
                  key={carry}
                  type="button"
                  onClick={() =>
                    void run({ op: "buy_carry", holder, carry }, () =>
                      t("inventory.bought").replace("{carry}", name),
                    )
                  }
                >
                  {t("inventory.buy")
                    .replace("{carry}", name)
                    .replace("{price}", String(price))}
                </button>
              );
            })}
          </div>
        ) : null}
        <div
          className="inventory__grid-scroll"
          tabIndex={0}
          role="group"
          aria-label={t("inventory.grid").replace(
            "{holder}",
            t(holder === "bond" ? "inventory.bond" : "inventory.avaia"),
          )}
          style={
            {
              "--inventory-frame-columns": frame.width,
              "--inventory-frame-rows": frame.height,
            } as CSSProperties
          }
        >
          <div
            className="inventory__grid"
            style={
              {
                "--inventory-columns": width,
                "--inventory-rows": height,
              } as CSSProperties
            }
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
            {carried.things.map((thing, index) => {
              const size = sizeOf(catalog, thing.id) ?? { width: 1, height: 1 };
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
                  aria-label={thingName(t, thing.id)}
                  aria-describedby={`${inventoryId}-${holder}-${index}`}
                  title={thingName(t, thing.id)}
                  style={{
                    gridColumn: `${thing.x + 1} / span ${size.width}`,
                    gridRow: `${thing.y + 1} / span ${size.height}`,
                  }}
                  onClick={(event) => {
                    selectedButtonRef.current = event.currentTarget;
                    setNote(undefined);
                    setSelected(pressed ? undefined : { holder, thing });
                  }}
                >
                  <ThingIcon id={thing.id} />
                  <span className="inventory__thing-number" aria-hidden="true">
                    {index + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {carried.things.length === 0 ? (
          <p className="inventory__hint">{t("inventory.holderEmpty")}</p>
        ) : (
          <ol className="inventory__manifest">
            {carried.things.map((thing, index) => (
              <li
                key={`${thing.x}:${thing.y}`}
                id={`${inventoryId}-${holder}-${index}`}
              >
                <span className="inventory__manifest-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span>{thingName(t, thing.id)}</span>
              </li>
            ))}
          </ol>
        )}
        {selected?.holder === holder ? selectionDetails() : null}
      </section>
    );
  }

  const price =
    selected === undefined ? undefined : priceOf(catalog, selected.thing.id);
  function selectionDetails() {
    if (selected === undefined) return null;
    return (
      <div className="inventory__selection" ref={detailsRef}>
        <div className="inventory__selection-heading">
          <ThingIcon id={selected.thing.id} />
          <strong>{thingName(t, selected.thing.id)}</strong>
          <button
            type="button"
            className="inventory__dismiss"
            aria-label={t("inventory.closeDetails")}
            onClick={() => {
              setSelected(undefined);
              selectedButtonRef.current?.focus();
            }}
          >
            ×
          </button>
        </div>
        <div className="inventory__actions">
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
          {together ? (
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
          ) : null}
        </div>
      </div>
    );
  }

  const other: CoreHolder = first === "avaia" ? "bond" : "avaia";
  const empty =
    model[first].things.length === 0 &&
    (!together || model[other].things.length === 0);

  return (
    <div className="inventory">
      <p className="inventory__seeds" role="status">
        {t("inventory.seeds").replace("{amount}", String(model.seeds))}
      </p>
      <p className="inventory__hint">
        {t(empty ? "inventory.empty" : "inventory.selectHint")}
      </p>
      {holderGrid(first, model[first])}
      {together ? (
        holderGrid(other, model[other])
      ) : (
        <p className="inventory__hint">{t(`inventory.apart.${other}`)}</p>
      )}
      {note === undefined ? null : (
        <p className="profile-edit__note" role="status">
          {note}
        </p>
      )}
      {shopAndCraft ? (
        <CraftSection
          owner={owner}
          core={core}
          model={model}
          catalog={catalog}
          committed={committed}
          place={workshop === undefined ? "anywhere" : "repair_workshop"}
          workshopName={workshop?.name}
        />
      ) : null}
    </div>
  );
}
