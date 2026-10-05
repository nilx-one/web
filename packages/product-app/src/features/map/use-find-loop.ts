// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CommittedAwardAccessPort } from "@nilx-one/application";
import {
  FIND_PACK_ID,
  ROLL_TABLE,
  awardsFor,
  canPickUp,
  epochOf,
  isFindPerceptible,
  rollAlong,
  rollSegment,
  segmentAt,
  type FindEarner,
  type FindLead,
  type FindRoll,
} from "@nilx-one/artifact-contract";
import type { MapPointSelection } from "@nilx-one/map-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AvaiaWalk } from "../map/avaia-walk";
import { claimedLeads } from "../progression/claims";
import {
  closeCommittedLead,
  currentCommittedLeads,
  pruneCommittedLeads,
  readCommittedJournal,
  recordedFindEvents,
  subscribeCommittedJournal,
} from "../progression/committed-journal";
import {
  queueWorldAwards,
  useCommittedAwardSync,
  type CommittedWorldEvent,
  type QueueWorldAward,
} from "../progression/committed-sync";

/** Ignore fixes too imprecise to establish entry into a 50 m find segment. */
export const FIND_OBSERVATION_ACCURACY_METERS = 50;

function awardKind(kind: "seen" | "picked_up"): "find_seen" | "find_picked_up" {
  return kind === "seen" ? "find_seen" : "find_picked_up";
}

/**
 * The committed intents one observed find creates. Pure so the R2 split
 * (Avaia keeps common finds, rare finds become leads for the Bond) is the same
 * seam the runtime and contract tests exercise.
 */
export function worldAwardsForFind(
  roll: FindRoll,
  by: FindEarner,
  recorded: Parameters<typeof awardsFor>[2],
  at: number,
): QueueWorldAward[] {
  const eventKind =
    by === "avaia" && !canPickUp(roll, "avaia") ? "seen" : "picked_up";
  return awardsFor(roll, { kind: eventKind, by }, recorded).map((award) => ({
    record: {
      kind: awardKind(award.kind),
      earner: award.earner,
      ...(award.kind === "picked_up" ? { tier: roll.tier } : {}),
      subject: roll.artifactId,
      at,
    },
    find: roll,
  }));
}

/**
 * Records one firsthand find intent. Nothing is written as kept here: the
 * committed sync owns intent -> server -> keep, so an offline or rejected
 * action remains pending rather than becoming local history.
 */
async function recordFind(
  owner: string,
  roll: FindRoll,
  by: FindEarner,
): Promise<void> {
  const snapshot = await readCommittedJournal(owner);
  const awards = worldAwardsForFind(
    roll,
    by,
    recordedFindEvents(snapshot),
    Date.now(),
  );
  if (awards.length === 0) return;
  await queueWorldAwards(owner, awards);
}

export interface FindLoopState {
  readonly leads: readonly FindLead[];
  /**
   * Called only for a route the Avaia actually completed. A route that was
   * planned and interrupted never rolls future segments.
   */
  completedAvaiaWalk(walk: AvaiaWalk): void;
}

/**
 * Connects movement to the already-canonical find/award/claim contracts.
 *
 * Avaia routes roll after completion. Bond finds come only from a real device
 * observation while the Bond drives; declared positions never enter this
 * hook. The server still decides committed experience and rare claims.
 */
export function useFindLoop({
  owner,
  port,
  bondDriving,
  device,
  onEvent,
}: {
  readonly owner: string;
  readonly port: CommittedAwardAccessPort | undefined;
  readonly bondDriving: boolean;
  /** Firsthand observation only; never a declared/manual position. */
  readonly device:
    (MapPointSelection & { readonly accuracyMeters: number }) | undefined;
  readonly onEvent?: (event: CommittedWorldEvent) => void;
}): FindLoopState {
  const [leads, setLeads] = useState<readonly FindLead[]>([]);
  const latestEvent = useRef(onEvent);
  useEffect(() => {
    latestEvent.current = onEvent;
  }, [onEvent]);

  useCommittedAwardSync({
    owner,
    port,
    onEvent: (event) => latestEvent.current?.(event),
  });

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const epoch = epochOf(Date.now());
      await pruneCommittedLeads(owner, epoch);
      const snapshot = await readCommittedJournal(owner);
      if (!cancelled) setLeads(currentCommittedLeads(snapshot, epoch));
    };
    const run = () => {
      void refresh().catch(() => undefined);
    };
    run();
    const unsubscribe = subscribeCommittedJournal(owner, run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [owner]);

  // While there are live rare leads, ask only for their sha buckets. Matching
  // remains local. A remote claim closes the lead; whose Bond it was is never
  // returned or inferred.
  //
  // Every journal write reads the leads anew, as a new array. The check is
  // keyed on which leads are open, not on that array, so a burst of writes
  // (a flush of queued awards, say) does not read the claims once per write
  // instead of once a minute.
  const openLeads = useRef(leads);
  useEffect(() => {
    openLeads.current = leads;
  }, [leads]);
  const leadKey = leads.map((lead) => lead.artifactId).join(",");
  useEffect(() => {
    if (port === undefined || leadKey === "") return;
    let cancelled = false;

    const check = async () => {
      const closed = await claimedLeads(port, openLeads.current);
      if (cancelled || closed === undefined) return;
      for (const lead of closed.yours) {
        await closeCommittedLead(owner, lead.artifactId, "already-yours");
      }
      for (const lead of closed.taken) {
        await closeCommittedLead(owner, lead.artifactId, "taken");
        latestEvent.current?.({
          kind: "find-taken",
          tier: lead.tier,
          artifactId: lead.artifactId,
        });
      }
    };

    void check().catch(() => undefined);
    const interval = globalThis.setInterval(
      () => void check().catch(() => undefined),
      60_000,
    );
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [leadKey, owner, port]);

  // Finds are earned only through committed awards: without the port a find
  // could never be paid, nor a rare one claimed, so none is rolled at all.
  const finding = port !== undefined;

  const completedAvaiaWalk = useCallback(
    (walk: AvaiaWalk): void => {
      if (!finding) return;
      const epoch = epochOf(Date.now());
      const path = walk.path.map(
        (point) => [point.longitude, point.latitude] as const,
      );
      const rolls = rollAlong(path, {
        packId: FIND_PACK_ID,
        packVersion: ROLL_TABLE.version,
        epoch,
      });
      void (async () => {
        for (const roll of rolls) {
          if (isFindPerceptible(roll)) await recordFind(owner, roll, "avaia");
        }
      })().catch(() => undefined);
    },
    [finding, owner],
  );

  // A location fix itself is not a walk. Remember the segment first, then
  // only entering a different segment while the Bond is driving can discover
  // that segment's find. This deliberately does not interpolate a GPS jump
  // into invented walked segments.
  const previousBondSegment = useRef<string | undefined>(undefined);
  const deviceLongitude = device?.longitude;
  const deviceLatitude = device?.latitude;
  const deviceAccuracy = device?.accuracyMeters;
  useEffect(() => {
    if (!finding) return;
    if (!bondDriving) {
      previousBondSegment.current =
        deviceLongitude === undefined || deviceLatitude === undefined
          ? undefined
          : `${epochOf(Date.now())}:${segmentAt([
              deviceLongitude,
              deviceLatitude,
            ])}`;
      return;
    }
    if (
      deviceLongitude === undefined ||
      deviceLatitude === undefined ||
      deviceAccuracy === undefined ||
      deviceAccuracy > FIND_OBSERVATION_ACCURACY_METERS
    ) {
      return;
    }

    const epoch = epochOf(Date.now());
    const segment = segmentAt([deviceLongitude, deviceLatitude]);
    const key = `${epoch}:${segment}`;
    const previous = previousBondSegment.current;
    previousBondSegment.current = key;
    if (previous === undefined || previous === key) return;

    const roll = rollSegment({
      packId: FIND_PACK_ID,
      packVersion: ROLL_TABLE.version,
      epoch,
      segment,
    });
    if (roll !== null) {
      void recordFind(owner, roll, "bond").catch(() => undefined);
    }
  }, [
    bondDriving,
    deviceAccuracy,
    deviceLatitude,
    deviceLongitude,
    finding,
    owner,
  ]);

  return { leads, completedAvaiaWalk };
}
