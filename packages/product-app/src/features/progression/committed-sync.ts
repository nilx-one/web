// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CommittedAward,
  CommittedAwardAccessPort,
} from "@nilx-one/application";
import {
  isClaimed,
  type ArtifactId,
  type FindLead,
} from "@nilx-one/artifact-contract";
import { useEffect, useRef } from "react";

import { resolvePickUp } from "./claims";
import {
  closeCommittedLead,
  dropCommittedAward,
  keepCommittedAward,
  noteCommittedLead,
  queueCommittedAward,
  readCommittedJournal,
  rebaseCommittedAwards,
  subscribeCommittedJournal,
  type PendingCommittedAward,
} from "./committed-journal";
import {
  notePublishedExperience,
  progressionSnapshot,
  subscribeProgression,
  updateProgression,
} from "./progression";
import { awardAmount, type AwardRecord } from "./commitment";

export type CommittedWorldEvent =
  | {
      readonly kind: "find-seen";
      readonly tier: number;
      readonly artifactId: ArtifactId;
    }
  | {
      readonly kind: "find-kept";
      readonly tier: number;
      readonly artifactId: ArtifactId;
      readonly earner: "bond" | "avaia";
      readonly experience: number;
    }
  | {
      readonly kind: "find-taken";
      readonly tier: number;
      readonly artifactId: ArtifactId;
    };

function toWire(award: PendingCommittedAward): CommittedAward {
  const { record } = award;
  const tier = record.kind === "find_picked_up" ? record.tier : undefined;
  return {
    id: award.id,
    parent: award.parent,
    chain: award.chain,
    kind: record.kind,
    earner: record.earner,
    ...(tier === undefined ? {} : { tier }),
    ...(tier !== undefined && isClaimed(tier)
      ? { artifactId: record.subject }
      : {}),
  };
}

function keptEvent(
  award: PendingCommittedAward,
): CommittedWorldEvent | undefined {
  const { record, find } = award;
  if (record.kind === "find_seen" && find !== undefined) {
    return {
      kind: "find-seen",
      tier: find.tier,
      artifactId: find.artifactId,
    };
  }
  if (record.kind !== "find_picked_up" || record.tier === undefined) {
    return undefined;
  }
  const amount = awardAmount(record);
  if (amount === null) return undefined;
  return {
    kind: "find-kept",
    tier: record.tier,
    artifactId: record.subject as ArtifactId,
    earner: record.earner,
    experience: amount,
  };
}

async function afterKeep(
  owner: string,
  award: PendingCommittedAward,
  onEvent: ((event: CommittedWorldEvent) => void) | undefined,
): Promise<void> {
  if (
    award.record.kind === "find_seen" &&
    award.find !== undefined &&
    isClaimed(award.find.tier)
  ) {
    const lead: FindLead = {
      artifactId: award.find.artifactId,
      segment: award.find.segment,
      epoch: award.find.epoch,
      tier: award.find.tier,
      seenAt: award.record.at,
    };
    await noteCommittedLead(owner, lead);
  }
  if (award.record.kind === "find_picked_up") {
    await closeCommittedLead(
      owner,
      award.record.subject as ArtifactId,
      "picked-up",
    );
  }
  const event = keptEvent(award);
  if (event !== undefined) onEvent?.(event);
}

const flights = new Map<string, Promise<void>>();

/**
 * Flushes one device chain in order. One award is sent at a time deliberately:
 * if the server drops an award, every later local commitment has to be rebased
 * before it can be offered.
 */
export function flushCommittedAwards(
  owner: string,
  port: CommittedAwardAccessPort,
  onEvent?: (event: CommittedWorldEvent) => void,
): Promise<void> {
  const current = flights.get(owner);
  if (current !== undefined) return current;

  const flight = (async () => {
    // Legacy carry/events have to land first. Otherwise a fresh committed
    // response could make this device forget local pre-R3 activity it has not
    // offered yet.
    const legacy = progressionSnapshot(owner);
    if (!legacy.carrySubmitted || legacy.pendingEvents.length > 0) return;

    for (let attempt = 0; attempt < 128; attempt += 1) {
      const snapshot = await readCommittedJournal(owner);
      const award = snapshot.pending[0];
      if (award === undefined) return;

      let result;
      try {
        result = await port.commitAwards([toWire(award)]);
      } catch {
        return;
      }

      if (result.kind === "service-unavailable") return;
      if (result.kind === "rejected") {
        if (result.reason !== "invalid") return;
        await dropCommittedAward(owner, award.id, "invalid");
        continue;
      }

      // The service's totals are the displayed totals. Adopt them even when
      // this particular award was refused: the answer is still authoritative
      // about the current client-reported standing.
      updateProgression(owner, (latest) =>
        notePublishedExperience(latest, result.experience, []),
      );

      const answer = result.results.find((item) => item.id === award.id);
      if (answer === undefined) return;

      if (award.record.kind === "find_picked_up") {
        const resolution = resolvePickUp(result, award.id);
        switch (resolution) {
          case "keep": {
            const kept = await keepCommittedAward(owner, award.id);
            if (kept !== undefined) await afterKeep(owner, kept, onEvent);
            continue;
          }
          case "close-quietly":
            await closeCommittedLead(
              owner,
              award.record.subject as ArtifactId,
              "already-yours",
            );
            await dropCommittedAward(owner, award.id, "already-yours");
            continue;
          case "oh-crap":
            await closeCommittedLead(
              owner,
              award.record.subject as ArtifactId,
              "taken",
            );
            onEvent?.({
              kind: "find-taken",
              tier: award.record.tier ?? 0,
              artifactId: award.record.subject as ArtifactId,
            });
            await dropCommittedAward(owner, award.id, "taken");
            continue;
          case "drop":
            if (answer.outcome.kind === "behind") {
              await rebaseCommittedAwards(
                owner,
                answer.outcome.head as `xp:${string}` | null,
              );
            } else {
              const reason =
                answer.outcome.kind === "capped"
                  ? "capped"
                  : answer.outcome.kind === "too-many-chains"
                    ? "too-many-chains"
                    : "invalid";
              await dropCommittedAward(owner, award.id, reason);
            }
            continue;
          case "wait":
            return;
        }
      }

      switch (answer.outcome.kind) {
        case "accepted":
        case "duplicate": {
          const kept = await keepCommittedAward(owner, award.id);
          if (kept !== undefined) await afterKeep(owner, kept, onEvent);
          break;
        }
        case "behind":
          await rebaseCommittedAwards(
            owner,
            answer.outcome.head as `xp:${string}` | null,
          );
          break;
        case "capped":
          await dropCommittedAward(owner, award.id, "capped");
          break;
        case "too-many-chains":
          await dropCommittedAward(owner, award.id, "too-many-chains");
          break;
        case "already-yours":
          await dropCommittedAward(owner, award.id, "already-yours");
          break;
        case "taken":
          await dropCommittedAward(owner, award.id, "taken");
          break;
      }
    }
  })().finally(() => {
    if (flights.get(owner) === flight) flights.delete(owner);
  });

  flights.set(owner, flight);
  return flight;
}

export interface QueueWorldAward {
  readonly record: AwardRecord;
  readonly find?: Parameters<typeof queueCommittedAward>[2];
}

/** Queue several facts in their observed order, preserving one device chain. */
export async function queueWorldAwards(
  owner: string,
  awards: readonly QueueWorldAward[],
): Promise<void> {
  for (const award of awards) {
    await queueCommittedAward(owner, award.record, award.find);
  }
}

/**
 * Drives committed awards whenever the local journal or the legacy migration
 * changes. Failure is represented by a pending commitment; the hook does not
 * manufacture a fallback award.
 */
export function useCommittedAwardSync({
  owner,
  port,
  onEvent,
}: {
  readonly owner: string;
  readonly port: CommittedAwardAccessPort | undefined;
  readonly onEvent?: (event: CommittedWorldEvent) => void;
}): void {
  const latest = useRef(onEvent);
  useEffect(() => {
    latest.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (port === undefined) return;
    let cancelled = false;
    let queued = false;

    const schedule = (): void => {
      if (cancelled || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (cancelled) return;
        void flushCommittedAwards(owner, port, (event) =>
          latest.current?.(event),
        ).catch(() => undefined);
      });
    };

    schedule();
    const unsubscribeJournal = subscribeCommittedJournal(owner, schedule);
    const unsubscribeProgression = subscribeProgression(schedule);
    const retry = globalThis.setInterval(schedule, 60_000);
    const onOnline = () => schedule();
    globalThis.addEventListener?.("online", onOnline);
    return () => {
      cancelled = true;
      globalThis.clearInterval(retry);
      globalThis.removeEventListener?.("online", onOnline);
      unsubscribeJournal();
      unsubscribeProgression();
    };
  }, [owner, port]);
}
