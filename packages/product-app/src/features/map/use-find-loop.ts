// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CommittedAwardAccessPort } from "@nilx-one/application";
import {
  FIND_PACK_ID,
  ROLL_TABLE,
  awardsFor,
  canPickUp,
  epochOf,
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
} from "../progression/committed-sync";

function awardKind(kind: "seen" | "picked_up"): "find_seen" | "find_picked_up" {
  return kind === "seen" ? "find_seen" : "find_picked_up";
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
  const recorded = recordedFindEvents(snapshot);
  const eventKind =
    by === "avaia" && !canPickUp(roll, "avaia") ? "seen" : "picked_up";
  const awards = awardsFor(roll, { kind: eventKind, by }, recorded);
  if (awards.length === 0) return;
  const at = Date.now();

  await queueWorldAwards(
    owner,
    awards.map((award) => ({
      record: {
        kind: awardKind(award.kind),
        earner: award.earner,
        ...(award.kind === "picked_up" ? { tier: roll.tier } : {}),
        subject: roll.artifactId,
        at,
      },
      find: roll,
    })),
  );
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
  readonly device: MapPointSelection | undefined;
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

  const refreshLeads = useCallback(async () => {
    const epoch = epochOf(Date.now());
    await pruneCommittedLeads(owner, epoch);
    const snapshot = await readCommittedJournal(owner);
    setLeads(currentCommittedLeads(snapshot, epoch));
  }, [owner]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void refreshLeads().catch(() => undefined);
    };
    void refreshLeads()
      .then(() => {
        if (cancelled) return;
      })
      .catch(() => undefined);
    const unsubscribe = subscribeCommittedJournal(owner, refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [owner, refreshLeads]);

  // While there are live rare leads, ask only for their sha buckets. Matching
  // remains local. A remote claim closes the lead; whose Bond it was is never
  // returned or inferred.
  useEffect(() => {
    if (port === undefined || leads.length === 0) return;
    let cancelled = false;

    const check = async () => {
      const closed = await claimedLeads(port, leads);
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

    void check();
    const interval = globalThis.setInterval(() => void check(), 60_000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [leads, owner, port]);

  const completedAvaiaWalk = useCallback(
    (walk: AvaiaWalk): void => {
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
        for (const roll of rolls) await recordFind(owner, roll, "avaia");
      })();
    },
    [owner],
  );

  // A location fix itself is not a walk. Remember the segment first, then
  // only entering a different segment while the Bond is driving can discover
  // that segment's find. This deliberately does not interpolate a GPS jump
  // into invented walked segments.
  const previousBondSegment = useRef<string | undefined>(undefined);
  const deviceLongitude = device?.longitude;
  const deviceLatitude = device?.latitude;
  useEffect(() => {
    if (
      !bondDriving ||
      deviceLongitude === undefined ||
      deviceLatitude === undefined
    ) {
      previousBondSegment.current =
        deviceLongitude === undefined || deviceLatitude === undefined
          ? undefined
          : `${epochOf(Date.now())}:${segmentAt([
              deviceLongitude,
              deviceLatitude,
            ])}`;
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
    if (roll !== null) void recordFind(owner, roll, "bond");
  }, [bondDriving, deviceLatitude, deviceLongitude, owner]);

  return { leads, completedAvaiaWalk };
}
