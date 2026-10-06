// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreEconomyCatalog, CoreRecipe } from "@nilx-one/application";
import { useEffect, useState } from "react";

import { useLocalization, type Translate } from "../../shell/localization";
import { finishCraft, isFinished, startCraft, type CraftPlace } from "./craft";
import type { InventoryModel, InventoryPort } from "./inventory";
import { thingName } from "./thing-name";

export function recipeTitle(
  t: Translate,
  recipe: { id: string; makes: string },
) {
  const item = thingName(t, recipe.makes);
  return (
    recipe.id.startsWith("repair_") ? t("craft.repair") : t("craft.make")
  ).replace("{item}", item);
}

function duration(t: Translate, recipe: CoreRecipe): string {
  return recipe.legendary
    ? t("craft.week")
    : t("craft.minutes").replace("{minutes}", String(recipe.minutes));
}

const ERRORS = new Set([
  "busy",
  "missing",
  "not_enough_seeds",
  "wrong_place",
] as const);

function errorText(t: Translate, error: string): string {
  return ERRORS.has(error as never)
    ? t(
        `craft.error.${error as "busy" | "missing" | "not_enough_seeds" | "wrong_place"}`,
      )
    : t("inventory.error.generic");
}

export interface CraftSectionProps {
  readonly owner: string;
  readonly core: InventoryPort;
  readonly model: InventoryModel;
  readonly catalog: CoreEconomyCatalog | undefined;
  /** Whether experience goes through committed awards on this host. */
  readonly committed: boolean;
  /** Where the Bond stands. */
  readonly place?: CraftPlace;
  /** The workshop's name, when the Bond stands at one. */
  readonly workshopName?: string | undefined;
}

/**
 * The recipes, and the craft running. Starting one asks first: what it uses
 * goes at once, and the thing comes when its time is up.
 */
export function CraftSection({
  owner,
  core,
  model,
  catalog,
  committed,
  place = "anywhere",
  workshopName,
}: CraftSectionProps) {
  const { t } = useLocalization();
  const [confirming, setConfirming] = useState<CoreRecipe | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());

  const craft = model.craft;
  useEffect(() => {
    if (craft === undefined) return;
    const tick = () => setNow(Date.now());
    const first = globalThis.setTimeout(tick, 0);
    const interval = globalThis.setInterval(tick, 30_000);
    return () => {
      globalThis.clearTimeout(first);
      globalThis.clearInterval(interval);
    };
  }, [craft]);

  const recipes = catalog?.recipes ?? [];
  const running =
    craft === undefined
      ? undefined
      : recipes.find((recipe) => recipe.id === craft.recipe);

  async function start(recipe: CoreRecipe): Promise<void> {
    setConfirming(undefined);
    const answer = await startCraft(owner, core, recipe, place).catch(() => ({
      ok: false as const,
      error: "generic",
    }));
    setNote(answer.ok ? undefined : errorText(t, answer.error));
  }

  async function finish(): Promise<void> {
    if (craft === undefined) return;
    const result = await finishCraft(owner, core, craft, committed).catch(
      () => ({ ok: false as const, error: "generic" }),
    );
    if (isFinished(result)) {
      setNote(
        `${t("craft.done.title").replace(
          "{item}",
          running === undefined ? "" : thingName(t, running.makes),
        )} ${t("craft.done.detail").replace("{xp}", String(result.experience))}`,
      );
      return;
    }
    setNote(
      result.ok
        ? undefined
        : result.error === "no_room"
          ? t("inventory.error.no_room")
          : errorText(t, result.error),
    );
  }

  return (
    <section className="inventory__craft" aria-labelledby="craft-title">
      <strong id="craft-title">{t("craft.title")}</strong>
      {place === "repair_workshop" ? (
        <small className="inventory__workshop">
          {t("craft.atWorkshop").replace(
            "{name}",
            workshopName ?? t("craft.workshopNoName"),
          )}
        </small>
      ) : null}
      {craft === undefined || running === undefined ? null : (
        <div className="inventory__craft-running" role="status">
          {craft.readyMs > now ? (
            <span>
              {t("craft.running")
                .replace("{item}", thingName(t, running.makes))
                .replace(
                  "{minutes}",
                  String(
                    Math.max(1, Math.ceil((craft.readyMs - now) / 60_000)),
                  ),
                )}
            </span>
          ) : (
            <>
              <span>
                {t("craft.ready").replace(
                  "{item}",
                  thingName(t, running.makes),
                )}
              </span>
              <button type="button" onClick={() => void finish()}>
                {t("craft.finish")}
              </button>
            </>
          )}
        </div>
      )}
      <ul className="inventory__recipes">
        {recipes.map((recipe) => (
          <li key={recipe.id} className="inventory__recipe">
            <div>
              <strong>{recipeTitle(t, recipe)}</strong>
              <small>
                {t("craft.uses")}:{" "}
                {recipe.consumes
                  .map(
                    ({ id, count }) =>
                      `${thingName(t, id)}${count > 1 ? ` ×${count}` : ""}`,
                  )
                  .join(", ")}
                {recipe.tools.length === 0
                  ? ""
                  : ` · ${t("craft.tools")}: ${recipe.tools
                      .map((id) => thingName(t, id))
                      .join(", ")}`}
              </small>
              <small>
                {duration(t, recipe)}
                {recipe.seeds > 0
                  ? ` · ${t("craft.cost").replace("{seeds}", String(recipe.seeds))}`
                  : ""}
                {` · ${t("craft.reward").replace("{xp}", String(recipe.experience))}`}
              </small>
              {recipe.place === "repair_workshop" &&
              place !== "repair_workshop" ? (
                <small>{t("craft.workshopOnly")}</small>
              ) : null}
              {recipe.legendary ? <small>{t("craft.legendary")}</small> : null}
            </div>
            {confirming?.id === recipe.id ? (
              <div className="inventory__actions" role="group">
                <small>
                  {t("craft.confirm").replace("{time}", duration(t, recipe))}
                </small>
                <button type="button" onClick={() => void start(recipe)}>
                  {t("craft.confirmYes")}
                </button>
                <button type="button" onClick={() => setConfirming(undefined)}>
                  {t("craft.confirmNo")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={craft !== undefined}
                onClick={() => {
                  setNote(undefined);
                  setConfirming(recipe);
                }}
              >
                {t("craft.start")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {note === undefined ? null : (
        <p className="profile-edit__note" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
