// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellIndex,
  PresenceStore,
  ShadeSource,
  VisitRecord,
} from "@nilx-one/presence-contract";

const DB_NAME = "nilx-presence";
const DB_VERSION = 1;
const VISITS_STORE = "visits";
const KEYS_STORE = "keys";
const JOURNAL_KEY_ID = "journal";

interface StoredVisit {
  readonly cell: CellIndex;
  readonly iv: Uint8Array;
  readonly ciphertext: ArrayBuffer;
}

interface SealedPayload {
  readonly enteredAt: number;
  readonly leftAt: number | null;
  readonly source: VisitRecord["source"];
  readonly fixCount: number;
  readonly bestAccuracyM: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assertStorageCapabilities(): void {
  if (typeof globalThis.indexedDB === "undefined") {
    throw new Error("Presence journal requires IndexedDB");
  }
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("Presence journal requires Web Crypto");
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
  assertStorageCapabilities();
  return new Promise((resolve, reject) => {
    const opening = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains(VISITS_STORE)) {
        const visits = database.createObjectStore(VISITS_STORE, {
          autoIncrement: true,
        });
        visits.createIndex("cell", "cell", { unique: false });
      }
      if (!database.objectStoreNames.contains(KEYS_STORE)) {
        database.createObjectStore(KEYS_STORE);
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () =>
      reject(opening.error ?? new Error("Presence journal could not open"));
  });
}

async function loadOrCreateKey(database: IDBDatabase): Promise<CryptoKey> {
  const read = database.transaction(KEYS_STORE, "readonly");
  const existing = await request<CryptoKey | undefined>(
    read.objectStore(KEYS_STORE).get(JOURNAL_KEY_ID),
  );
  if (existing !== undefined) return existing;

  const candidate = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  // Read and write in one serialised transaction so concurrent tabs converge
  // on one non-extractable device key rather than replacing each other.
  const write = database.transaction(KEYS_STORE, "readwrite");
  const keys = write.objectStore(KEYS_STORE);
  const winner = await request<CryptoKey | undefined>(keys.get(JOURNAL_KEY_ID));
  if (winner !== undefined) {
    await transactionDone(write);
    return winner;
  }
  await request(keys.put(candidate, JOURNAL_KEY_ID));
  await transactionDone(write);
  return candidate;
}

function fold(records: readonly VisitRecord[]): VisitRecord[] {
  const byEntry = new Map<number, VisitRecord>();
  for (const record of records) {
    const previous = byEntry.get(record.enteredAt);
    if (previous === undefined) {
      byEntry.set(record.enteredAt, record);
      continue;
    }
    const recordClosedAt = record.leftAt ?? -1;
    const previousClosedAt = previous.leftAt ?? -1;
    byEntry.set(
      record.enteredAt,
      recordClosedAt > previousClosedAt || record.fixCount > previous.fixCount
        ? record
        : previous,
    );
  }
  return [...byEntry.values()].sort(
    (left, right) => left.enteredAt - right.enteredAt,
  );
}

export interface IdbPresenceStore extends PresenceStore {
  rawRecordsForCell(cell: CellIndex): Promise<readonly VisitRecord[]>;
  close(): void;
}

export async function createPresenceStore(): Promise<IdbPresenceStore> {
  const database = await openDatabase();
  const key = await loadOrCreateKey(database);
  const listeners = new Set<(record: VisitRecord) => void>();

  async function seal(record: VisitRecord): Promise<StoredVisit> {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const payload: SealedPayload = {
      enteredAt: record.enteredAt,
      leftAt: record.leftAt,
      source: record.source,
      fixCount: record.fixCount,
      bestAccuracyM: record.bestAccuracyM,
    };
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(record.cell),
      },
      key,
      encoder.encode(JSON.stringify(payload)),
    );
    return { cell: record.cell, iv, ciphertext };
  }

  async function unseal(stored: StoredVisit): Promise<VisitRecord> {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: stored.iv as BufferSource,
        additionalData: encoder.encode(stored.cell),
      },
      key,
      stored.ciphertext,
    );
    const payload = JSON.parse(decoder.decode(plaintext)) as SealedPayload;
    return {
      cell: stored.cell,
      enteredAt: payload.enteredAt,
      leftAt: payload.leftAt,
      source: payload.source,
      fixCount: payload.fixCount,
      bestAccuracyM: payload.bestAccuracyM,
    };
  }

  async function rawRecordsForCell(cell: CellIndex): Promise<VisitRecord[]> {
    const transaction = database.transaction(VISITS_STORE, "readonly");
    const stored = await request<StoredVisit[]>(
      transaction.objectStore(VISITS_STORE).index("cell").getAll(cell),
    );
    const records = await Promise.all(stored.map(unseal));
    records.sort((left, right) => left.enteredAt - right.enteredAt);
    return records;
  }

  return {
    async append(record) {
      const sealed = await seal(record);
      const transaction = database.transaction(VISITS_STORE, "readwrite");
      await request(transaction.objectStore(VISITS_STORE).add(sealed));
      await transactionDone(transaction);
      for (const listener of [...listeners]) listener(record);
    },

    async listCells() {
      const cells: CellIndex[] = [];
      const index = database
        .transaction(VISITS_STORE, "readonly")
        .objectStore(VISITS_STORE)
        .index("cell");
      await new Promise<void>((resolve, reject) => {
        const cursorRequest = index.openKeyCursor(null, "nextunique");
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor === null) {
            resolve();
            return;
          }
          cells.push(String(cursor.key));
          cursor.continue();
        };
        cursorRequest.onerror = () =>
          reject(
            cursorRequest.error ??
              new Error("Presence cell index could not be read"),
          );
      });
      return cells;
    },

    async recordsForCell(cell) {
      return fold(await rawRecordsForCell(cell));
    },

    rawRecordsForCell,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      listeners.clear();
      database.close();
    },
  };
}

export interface IdbShadeSource extends ShadeSource {
  close(): void;
}

export async function createShadeSource(
  store: PresenceStore,
): Promise<IdbShadeSource> {
  const lit = new Set<CellIndex>(await store.listCells());
  const listeners = new Set<(cell: CellIndex) => void>();
  const unsubscribe = store.subscribe((record) => {
    if (lit.has(record.cell)) return;
    lit.add(record.cell);
    for (const listener of [...listeners]) listener(record.cell);
  });

  return {
    litCells: () => [...lit],
    isLit: (cell) => lit.has(cell),
    onCellLit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      unsubscribe();
      listeners.clear();
    },
  };
}

export interface LocalPresenceJournal {
  readonly store: IdbPresenceStore;
  readonly source: IdbShadeSource;
  close(): void;
}

export async function createLocalPresenceJournal(): Promise<LocalPresenceJournal> {
  const store = await createPresenceStore();
  try {
    const source = await createShadeSource(store);
    return {
      store,
      source,
      close() {
        source.close();
        store.close();
      },
    };
  } catch (error) {
    store.close();
    throw error;
  }
}
