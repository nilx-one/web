// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { LocalModelDependency } from "../../shell/local-model-host";
import {
  chooseOuting,
  LOW_ENERGY,
  type DriveState,
  type OutingChoice,
} from "./outing-drive";
import { menuForModel, NEAR_METERS, type OutingMenu } from "./outing-targets";
import { feelingFor } from "./place-affinity";

export const DECISION_TIMEOUT_MS = 30_000;
export type WalkOutcome =
  "none" | "arrived" | "blocked" | "interrupted" | "stayed";
export type DecisionReason =
  | "not-wired"
  | "unsupported"
  | "not-cached"
  | "not-local"
  | "invalid-output"
  | "error"
  | "timeout"
  | "cancelled"
  | "busy"
  | "rest";
export interface OutingDecision {
  readonly choice: OutingChoice;
  readonly source: "model" | "rules";
  readonly reason?: DecisionReason;
}
export interface OutingDecisionInput {
  readonly state: DriveState;
  readonly menu: OutingMenu;
  readonly context: Parameters<typeof chooseOuting>[2];
  readonly outcome: WalkOutcome;
}
export type OutingDecider = (
  input: OutingDecisionInput,
  signal: AbortSignal,
) => Promise<OutingDecision>;

/** A bounded, local, closed-menu choice. No location or identity reaches inference. */
export function createOutingDecider(
  local: LocalModelDependency | undefined,
  readChoice: () => string | undefined,
): OutingDecider {
  // A timed-out worker may still be unloading. Never pile a new engine on top.
  let busy = false;
  return async ({ state, menu, context, outcome }, signal) => {
    const evening = context.hour >= 20 || context.hour < 7;
    const offered: OutingMenu = {
      options: menu.options.filter(
        (option) =>
          option.kind !== "target" ||
          !evening ||
          option.target.meters <= NEAR_METERS,
      ),
    };
    const fallback = chooseOuting(state, offered, context);
    const rules = (reason: DecisionReason): OutingDecision => ({
      choice: fallback,
      source: "rules",
      reason,
    });
    if (signal.aborted) return rules("cancelled");
    if (state.energy < LOW_ENERGY) return rules("rest");
    if (local === undefined) return rules("not-wired");
    if (busy) return rules("busy");
    busy = true;
    const controller = new AbortController();
    let timedOut = false;
    let finishAbort!: (value: OutingDecision) => void;
    const aborted = new Promise<OutingDecision>((resolve) => {
      finishAbort = resolve;
    });
    const cancel = () => controller.abort();
    const onAbort = () =>
      finishAbort(rules(timedOut ? "timeout" : "cancelled"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, DECISION_TIMEOUT_MS);
    let engine: Awaited<ReturnType<typeof local.host.open>> | undefined;
    let closing: Promise<void> | undefined;
    const close = () => {
      if (engine !== undefined)
        closing ??= engine.unload().catch(() => undefined);
      return closing;
    };
    controller.signal.addEventListener(
      "abort",
      () => {
        void close();
      },
      { once: true },
    );
    const run = async (): Promise<OutingDecision> => {
      try {
        const selected = readChoice();
        let id =
          local.catalog.find((entry) => entry.modelId === selected)?.modelId ??
          local.defaultModelId;
        let verdict = await local.host.inspect(id);
        if (verdict.kind !== "usable" && id !== local.defaultModelId) {
          id = local.defaultModelId;
          verdict = await local.host.inspect(id);
        }
        if (verdict.kind !== "usable") return rules("unsupported");
        if (controller.signal.aborted) return rules("cancelled");
        if (!(await local.host.isCached(id))) return rules("not-cached");
        // Outings use our mirror only. They never start an upstream download.
        if ((await local.host.describe(id)).source !== "mirror")
          return rules("not-local");
        if (controller.signal.aborted) return rules("cancelled");
        engine = await local.host.open(id, () => undefined, controller.signal);
        if (controller.signal.aborted) return rules("cancelled");
        if (engine.rephrase === undefined) return rules("unsupported");
        const options = menuForModel(
          offered,
          context.affinity === undefined
            ? undefined
            : (id) =>
                feelingFor(context.affinity!, id, context.now ?? Date.now()),
        );
        const text = await engine.rephrase(
          "You are Avaia, a simulated companion choosing her next walk. Choose exactly one offered index. " +
            "When rested prefer exploring or revisiting a fond place over staying. After a blocked walk try another option. " +
            "Stay if you want a pause. Reply with only the integer index, without explanation. /no_think",
          JSON.stringify({
            motive: options.some(
              (option) =>
                "feeling" in option &&
                (option.feeling === "fond" || option.feeling === "loved"),
            )
              ? "longing"
              : "curiosity",
            energy: state.energy < 0.6 ? "moderate" : "high",
            time: evening ? "evening" : "day",
            previous: outcome,
            options,
          }),
          { maxNewTokens: 16, temperature: 0.5, topP: 0.9 },
        );
        if (controller.signal.aborted) return rules("cancelled");
        const answer = text.replace(/^\s*<think>\s*<\/think>/u, "").trim();
        if (!/^(0|[1-9][0-9]*)$/u.test(answer)) return rules("invalid-output");
        const choice = offered.options[Number(answer)];
        return choice === undefined
          ? rules("invalid-output")
          : { choice, source: "model" };
      } catch {
        return rules("error");
      } finally {
        await close();
      }
    };
    const task = run().finally(() => {
      busy = false;
    });
    try {
      return await Promise.race([task, aborted]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", onAbort);
    }
  };
}
