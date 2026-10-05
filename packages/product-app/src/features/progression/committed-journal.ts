// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  isClaimed,
  liveLeads as liveArtifactLeads,
  parseLeads,
  type ArtifactId,
  type EpochId,
  type FindEvent,
  type FindLead,
  type FindRoll,
} from "@nilx-one/artifact-contract";

import {
  commitAward,
  newHistoryKey,
  type AwardRecord,
  type Commitment,
} from "./commitment";

/**
 * Device-side R3 history.
 *
 * The service sees only commitments, their chain fields, priced award kinds,
 * and a rare artifact id when a claim is required. The record that produced a
 * commitment stays here. Events are encrypted and append-only; the small
 * mutable meta record is only the opaque current chain/head needed to append
 * the next commitment.
 */
const DB_NAME = "avaia-finds";
const DB_VERSION = 1;
const EVENTS_STORE = "events";
const SEAL_KEYS_STORE = "seal-keys";
const HISTORY_KEYS_STORE = "history-keys";
const META_STORE = "meta";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type AwardDropReason =
  | "capped"
  | "taken"
  | "already-yours"
  | "too-many-chains"
  | "invalid"
  | "rebased";

export interface PendingCommittedAward {
  readonly id: Commitment;
  readonly parent: Commitment | null;
  readonly chain: string;
  readonly record: AwardRecord;
  /** Local roll evidence. Never sent as a record. */
  readonly find?: FindRoll;
}

export type KeptCommittedAward = PendingCommittedAward;

export interface CommittedJournalSnapshot {
  readonly chain: string;
  readonly head: Commitment | null;
  readonly pending: readonly PendingCommittedAward[];
  readonly history: readonly KeptCommittedAward[];
  readonly leads: readonly FindLead[];
}

interface StoredEvent {
  readonly owner: string;
  readonly iv: Uint8Array;
  readonly ciphertext: ArrayBuffer;
}

interface JournalMeta {
  readonly chain: string;
  readonly head: Commitment | null;
}

type JournalEvent =
  | {
      readonly type: "award.pending";
      readonly award: PendingCommittedAward;
    }
  | {
      readonly type: "award.kept";
      readonly id: Commitment;
    }
  | {
      readonly type: "award.dropped";
      readonly id: Commitment;
      readonly reason: AwardDropReason;
    }
  | {
      readonly type: "lead.noted";
      readonly lead: FindLead;
    }
  | {
      readonly type: "lead.closed";
      readonly artifactId: ArtifactId;
      readonly reason: "picked-up" | "already-yours" | "taken" | "expired";
    };

function assertCapabilities(): void {
  if (typeof globalThis.indexedDB === "undefined") {
    throw new Error("Committed history requires IndexedDB");
  }
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("Committed history requires Web Crypto");
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(value.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  assertCapabilities();
  return new Promise((resolve, reject) => {
    const opening = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains(EVENTS_STORE)) {
        const events = database.createObjectStore(EVENTS_STORE, {
          autoIncrement: true,
        });
        events.createIndex("owner", "owner", { unique: false });
      }
      if (!database.objectStoreNames.contains(SEAL_KEYS_STORE)) {
        database.createObjectStore(SEAL_KEYS_STORE);
      }
      if (!database.objectStoreNames.contains(HISTORY_KEYS_STORE)) {
        database.createObjectStore(HISTORY_KEYS_STORE);
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE);
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () =>
      reject(opening.error ?? new Error("Committed history could not open"));
  });
}

async function loadOrCreateSealKey(
  database: IDBDatabase,
  owner: string,
): Promise<CryptoKey> {
  const candidate = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const transaction = database.transaction(SEAL_KEYS_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(SEAL_KEYS_STORE);
  const existing = await request<CryptoKey | undefined>(store.get(owner));
  if (existing !== undefined) {
    await done;
    return existing;
  }
  await request(store.put(candidate, owner));
  await done;
  return candidate;
}

async function loadOrCreateHistoryKey(
  database: IDBDatabase,
  owner: string,
): Promise<CryptoKey> {
  // Generate before opening the write transaction: Web Crypto may yield while
  // another tab creates the winner. The transaction re-check decides which
  // key is canonical for this browser database.
  const candidate = await newHistoryKey();
  const transaction = database.transaction(HISTORY_KEYS_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(HISTORY_KEYS_STORE);
  const existing = await request<CryptoKey | undefined>(store.get(owner));
  if (existing !== undefined) {
    await done;
    return existing;
  }
  await request(store.put(candidate, owner));
  await done;
  return candidate;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function newChain(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `ch:${base64url(bytes)}`;
}

async function loadOrCreateMeta(
  database: IDBDatabase,
  owner: string,
): Promise<JournalMeta> {
  const transaction = database.transaction(META_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(META_STORE);
  const existing = await request<JournalMeta | undefined>(store.get(owner));
  if (existing !== undefined) {
    await done;
    return existing;
  }
  const created: JournalMeta = { chain: newChain(), head: null };
  await request(store.put(created, owner));
  await done;
  return created;
}

async function seal(
  owner: string,
  key: CryptoKey,
  event: JournalEvent,
): Promise<StoredEvent> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(owner),
    },
    key,
    encoder.encode(JSON.stringify(event)),
  );
  return { owner, iv, ciphertext };
}

async function unseal(
  owner: string,
  key: CryptoKey,
  stored: StoredEvent,
): Promise<JournalEvent> {
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: stored.iv as BufferSource,
      additionalData: encoder.encode(owner),
    },
    key,
    stored.ciphertext,
  );
  const parsed = JSON.parse(decoder.decode(plaintext)) as unknown;
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    throw new Error("Committed history contains a malformed event");
  }
  return parsed as JournalEvent;
}

async function readEvents(
  database: IDBDatabase,
  owner: string,
  sealKey: CryptoKey,
): Promise<readonly JournalEvent[]> {
  const transaction = database.transaction(EVENTS_STORE, "readonly");
  const stored = await request<StoredEvent[]>(
    transaction.objectStore(EVENTS_STORE).index("owner").getAll(owner),
  );
  return Promise.all(stored.map((event) => unseal(owner, sealKey, event)));
}

export function foldCommittedJournal(
  meta: JournalMeta,
  events: readonly JournalEvent[],
): CommittedJournalSnapshot {
  const definitions = new Map<Commitment, PendingCommittedAward>();
  const order: Commitment[] = [];
  const active = new Set<Commitment>();
  const history: KeptCommittedAward[] = [];
  let leads: FindLead[] = [];

  for (const event of events) {
    switch (event.type) {
      case "award.pending":
        definitions.set(event.award.id, event.award);
        order.push(event.award.id);
        active.add(event.award.id);
        break;
      case "award.kept": {
        const award = definitions.get(event.id);
        if (award !== undefined && active.has(event.id)) history.push(award);
        active.delete(event.id);
        break;
      }
      case "award.dropped":
        active.delete(event.id);
        break;
      case "lead.noted":
        leads = parseLeads([...leads, event.lead]);
        break;
      case "lead.closed":
        leads = leads.filter((lead) => lead.artifactId !== event.artifactId);
        break;
    }
  }

  return {
    chain: meta.chain,
    head: meta.head,
    pending: order.flatMap((id) => {
      const award = definitions.get(id);
      return award !== undefined && active.has(id) ? [award] : [];
    }),
    history,
    leads,
  };
}

async function snapshotFrom(
  database: IDBDatabase,
  owner: string,
): Promise<{
  readonly snapshot: CommittedJournalSnapshot;
  readonly sealKey: CryptoKey;
  readonly historyKey: CryptoKey;
  readonly meta: JournalMeta;
}> {
  const [sealKey, historyKey, meta] = await Promise.all([
    loadOrCreateSealKey(database, owner),
    loadOrCreateHistoryKey(database, owner),
    loadOrCreateMeta(database, owner),
  ]);
  const events = await readEvents(database, owner, sealKey);
  return {
    snapshot: foldCommittedJournal(meta, events),
    sealKey,
    historyKey,
    meta,
  };
}

export async function readCommittedJournal(
  owner: string,
): Promise<CommittedJournalSnapshot> {
  const database = await openDatabase();
  try {
    return (await snapshotFrom(database, owner)).snapshot;
  } finally {
    database.close();
  }
}

function sameAward(left: AwardRecord, right: AwardRecord): boolean {
  return (
    left.kind === right.kind &&
    left.earner === right.earner &&
    left.tier === right.tier &&
    left.subject === right.subject
  );
}

async function appendEvent(
  database: IDBDatabase,
  owner: string,
  sealKey: CryptoKey,
  event: JournalEvent,
): Promise<void> {
  const stored = await seal(owner, sealKey, event);
  const transaction = database.transaction(EVENTS_STORE, "readwrite");
  await request(transaction.objectStore(EVENTS_STORE).add(stored));
  await transactionDone(transaction);
}

const mutationTail = new Map<string, Promise<void>>();

function serial<T>(owner: string, operation: () => Promise<T>): Promise<T> {
  const before = mutationTail.get(owner) ?? Promise.resolve();
  let resolveTail!: () => void;
  const tail = new Promise<void>((resolve) => {
    resolveTail = resolve;
  });
  mutationTail.set(owner, tail);
  return before
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      resolveTail();
      if (mutationTail.get(owner) === tail) mutationTail.delete(owner);
    });
}

const listeners = new Map<string, Set<() => void>>();

function notify(owner: string): void {
  for (const listener of [...(listeners.get(owner) ?? [])]) listener();
}

export function subscribeCommittedJournal(
  owner: string,
  listener: () => void,
): () => void {
  const own = listeners.get(owner) ?? new Set<() => void>();
  own.add(listener);
  listeners.set(owner, own);
  return () => {
    own.delete(listener);
    if (own.size === 0) listeners.delete(owner);
  };
}

/**
 * Creates the pending intent and its commitment. Repeated semantic facts are
 * coalesced before they can mint another commitment.
 */
export function queueCommittedAward(
  owner: string,
  record: AwardRecord,
  find?: FindRoll,
): Promise<PendingCommittedAward | undefined> {
  return serial(owner, async () => {
    const database = await openDatabase();
    try {
      const { snapshot, sealKey, historyKey, meta } = await snapshotFrom(
        database,
        owner,
      );
      const known = [...snapshot.history, ...snapshot.pending].find((award) =>
        sameAward(award.record, record),
      );
      if (known !== undefined) return known;

      const parent =
        snapshot.pending[snapshot.pending.length - 1]?.id ?? meta.head;
      const id = await commitAward(historyKey, parent, record);
      const award: PendingCommittedAward = {
        id,
        parent,
        chain: meta.chain,
        record,
        ...(find === undefined ? {} : { find }),
      };
      await appendEvent(database, owner, sealKey, {
        type: "award.pending",
        award,
      });
      notify(owner);
      return award;
    } finally {
      database.close();
    }
  });
}

export type KeptAwardLeadChange =
  | { readonly kind: "note"; readonly lead: FindLead }
  | { readonly kind: "close"; readonly artifactId: ArtifactId }
  | undefined;

/** The lead mutation that belongs to an accepted find award, if any. */
export function leadChangeForKeptAward(
  snapshot: Pick<CommittedJournalSnapshot, "leads">,
  award: PendingCommittedAward,
): KeptAwardLeadChange {
  if (
    award.record.kind === "find_seen" &&
    award.find !== undefined &&
    isClaimed(award.find.tier) &&
    !snapshot.leads.some(
      (lead) => lead.artifactId === award.find?.artifactId,
    )
  ) {
    return {
      kind: "note",
      lead: {
        artifactId: award.find.artifactId,
        segment: award.find.segment,
        epoch: award.find.epoch,
        tier: award.find.tier,
        seenAt: award.record.at,
      },
    };
  }
  if (
    award.record.kind === "find_picked_up" &&
    snapshot.leads.some(
      (lead) => lead.artifactId === award.record.subject,
    )
  ) {
    return {
      kind: "close",
      artifactId: award.record.subject as ArtifactId,
    };
  }
  return undefined;
}

/**
 * Marks the first pending award kept, advances the local chain head, and
 * applies the find's lead consequence in the same IndexedDB transaction.
 */
export function keepCommittedAward(
  owner: string,
  id: Commitment,
): Promise<PendingCommittedAward | undefined> {
  return serial(owner, async () => {
    const database = await openDatabase();
    try {
      const { snapshot, sealKey, meta } = await snapshotFrom(database, owner);
      const award = snapshot.pending[0];
      if (award === undefined || award.id !== id) return undefined;
      const events: JournalEvent[] = [{ type: "award.kept", id }];
      const leadChange = leadChangeForKeptAward(snapshot, award);
      if (leadChange?.kind === "note") {
        events.push({ type: "lead.noted", lead: leadChange.lead });
      } else if (leadChange?.kind === "close") {
        events.push({
          type: "lead.closed",
          artifactId: leadChange.artifactId,
          reason: "picked-up",
        });
      }
      const stored = await Promise.all(
        events.map((event) => seal(owner, sealKey, event)),
      );
      const transaction = database.transaction(
        [EVENTS_STORE, META_STORE],
        "readwrite",
      );
      const done = transactionDone(transaction);
      for (const event of stored) {
        await request(transaction.objectStore(EVENTS_STORE).add(event));
      }
      await request(
        transaction.objectStore(META_STORE).put({ ...meta, head: id }, owner),
      );
      await done;
      notify(owner);
      return award;
    } finally {
      database.close();
    }
  });
}

export async function rebasePendingAwards(
  historyKey: CryptoKey,
  chain: string,
  parent: Commitment | null,
  awards: readonly PendingCommittedAward[],
): Promise<PendingCommittedAward[]> {
  const next: PendingCommittedAward[] = [];
  let head = parent;
  for (const award of awards) {
    const id = await commitAward(historyKey, head, award.record);
    next.push({
      ...award,
      id,
      parent: head,
      chain,
    });
    head = id;
  }
  return next;
}

async function writeRebase(
  database: IDBDatabase,
  owner: string,
  sealKey: CryptoKey,
  meta: JournalMeta,
  oldAwards: readonly PendingCommittedAward[],
  nextAwards: readonly PendingCommittedAward[],
  firstReason: AwardDropReason,
  head: Commitment | null,
): Promise<void> {
  const events: JournalEvent[] = [
    ...oldAwards.map((award, index): JournalEvent => ({
      type: "award.dropped",
      id: award.id,
      reason: index === 0 ? firstReason : "rebased",
    })),
    ...nextAwards.map((award): JournalEvent => ({
      type: "award.pending",
      award,
    })),
  ];
  const sealed = await Promise.all(
    events.map((event) => seal(owner, sealKey, event)),
  );
  const transaction = database.transaction(
    [EVENTS_STORE, META_STORE],
    "readwrite",
  );
  const done = transactionDone(transaction);
  for (const event of sealed) {
    await request(transaction.objectStore(EVENTS_STORE).add(event));
  }
  await request(
    transaction.objectStore(META_STORE).put({ ...meta, head }, owner),
  );
  await done;
}

/**
 * Drops the first pending award and re-commits every descendant onto the last
 * accepted head. A child never keeps a parent the server refused.
 */
export function dropCommittedAward(
  owner: string,
  id: Commitment,
  reason: Exclude<AwardDropReason, "rebased">,
): Promise<PendingCommittedAward | undefined> {
  return serial(owner, async () => {
    const database = await openDatabase();
    try {
      const { snapshot, sealKey, historyKey, meta } = await snapshotFrom(
        database,
        owner,
      );
      const first = snapshot.pending[0];
      if (first === undefined || first.id !== id) return undefined;
      const rest = snapshot.pending.slice(1);
      const next = await rebasePendingAwards(
        historyKey,
        meta.chain,
        meta.head,
        rest,
      );
      await writeRebase(
        database,
        owner,
        sealKey,
        meta,
        snapshot.pending,
        next,
        reason,
        meta.head,
      );
      notify(owner);
      return first;
    } finally {
      database.close();
    }
  });
}

/**
 * The service says our parent is behind. Its head is fact; all local pending
 * records are re-committed on top of that head without pretending the missing
 * local record exists.
 */
export function rebaseCommittedAwards(
  owner: string,
  head: Commitment | null,
): Promise<void> {
  return serial(owner, async () => {
    const database = await openDatabase();
    try {
      const { snapshot, sealKey, historyKey, meta } = await snapshotFrom(
        database,
        owner,
      );
      if (snapshot.pending.length === 0) {
        if (meta.head === head) return;
        const transaction = database.transaction(META_STORE, "readwrite");
        await request(
          transaction.objectStore(META_STORE).put({ ...meta, head }, owner),
        );
        await transactionDone(transaction);
        notify(owner);
        return;
      }
      const next = await rebasePendingAwards(
        historyKey,
        meta.chain,
        head,
        snapshot.pending,
      );
      await writeRebase(
        database,
        owner,
        sealKey,
        meta,
        snapshot.pending,
        next,
        "rebased",
        head,
      );
      notify(owner);
    } finally {
      database.close();
    }
  });
}

export function noteCommittedLead(
  owner: string,
  lead: FindLead,
): Promise<void> {
  return serial(owner, async () => {
    const database = await openDatabase();
    try {
      const { snapshot, sealKey } = await snapshotFrom(database, owner);
      if (
        snapshot.leads.some((current) => current.artifactId === lead.artifactId)
      ) {
        return;
      }
      await appendEvent(database, owner, sealKey, {
        type: "lead.noted",
        lead,
      });
      notify(owner);
    } finally {
      database.close();
    }
  });
}

export function closeCommittedLead(
  owner: string,
  artifactId: ArtifactId,
  reason: "picked-up" | "already-yours" | "taken" | "expired",
): Promise<void> {
  return serial(owner, async () => {
    const database = await openDatabase();
    try {
      const { snapshot, sealKey } = await snapshotFrom(database, owner);
      if (!snapshot.leads.some((lead) => lead.artifactId === artifactId))
        return;
      await appendEvent(database, owner, sealKey, {
        type: "lead.closed",
        artifactId,
        reason,
      });
      notify(owner);
    } finally {
      database.close();
    }
  });
}

export async function pruneCommittedLeads(
  owner: string,
  epoch: EpochId,
): Promise<void> {
  const snapshot = await readCommittedJournal(owner);
  for (const lead of snapshot.leads) {
    if (lead.epoch !== epoch) {
      await closeCommittedLead(owner, lead.artifactId, "expired");
    }
  }
}

/** Find facts that the server accepted and this device therefore kept. */
export function recordedFindEvents(
  snapshot: Pick<CommittedJournalSnapshot, "history">,
): FindEvent[] {
  const events: FindEvent[] = [];
  const seen = new Set<ArtifactId>();
  const picked = new Set<ArtifactId>();

  for (const award of snapshot.history) {
    const { record } = award;
    if (record.kind !== "find_seen" && record.kind !== "find_picked_up") {
      continue;
    }
    const artifactId = record.subject as ArtifactId;
    if (record.kind === "find_seen") {
      if (!seen.has(artifactId)) {
        seen.add(artifactId);
        events.push({ artifactId, kind: "seen", by: record.earner });
      }
      continue;
    }
    // Picking something up necessarily means it was seen, even if a sighting
    // award hit its weekly cap and therefore was not kept as its own record.
    if (!seen.has(artifactId)) {
      seen.add(artifactId);
      events.push({ artifactId, kind: "seen", by: record.earner });
    }
    if (!picked.has(artifactId)) {
      picked.add(artifactId);
      events.push({ artifactId, kind: "picked_up", by: record.earner });
    }
  }
  return events;
}

export function currentCommittedLeads(
  snapshot: Pick<CommittedJournalSnapshot, "leads">,
  epoch: EpochId,
): FindLead[] {
  return liveArtifactLeads(snapshot.leads, epoch);
}

export const COMMITTED_JOURNAL_DATABASE = DB_NAME;
export const COMMITTED_JOURNAL_STORES = {
  events: EVENTS_STORE,
  sealKeys: SEAL_KEYS_STORE,
  historyKeys: HISTORY_KEYS_STORE,
  meta: META_STORE,
} as const;
