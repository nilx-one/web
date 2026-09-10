// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellIndex,
  PresenceStore,
  VisitRecord,
} from "@nilx-one/presence-contract";

import {
  createJournalCipher,
  generateJournalKey,
  type JournalCipher,
  type SealedVisit,
} from "./journal-cipher";

export {
  IV_BYTES,
  JOURNAL_KEY_ALGORITHM,
  JOURNAL_KEY_LENGTH,
  createJournalCipher,
  generateJournalKey,
  type JournalCipher,
  type SealedVisit,
} from "./journal-cipher";

export const PRESENCE_DATABASE_NAME = "nilx-one-presence";
export const PRESENCE_DATABASE_VERSION = 1;
export const VISITS_STORE = "visits";
export const KEYS_STORE = "keys";
export const CELL_INDEX = "cell";
export const JOURNAL_KEY_ID = "journal";

export interface PresenceIdbEnvironment {
  readonly indexedDB: IDBFactory;
  readonly crypto: Pick<Crypto, "getRandomValues" | "subtle">;
  readonly databaseName?: string;
}

/** A store that can be closed, which the contract's consumers never need. */
export interface PresenceIdbStore extends PresenceStore {
  close(): void;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("transaction failed"));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, PRESENCE_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VISITS_STORE)) {
        // autoIncrement, and no keyPath: a visit has no identity of its own to
        // be addressed or overwritten by. Appending is the only way in.
        const visits = db.createObjectStore(VISITS_STORE, {
          autoIncrement: true,
        });
        visits.createIndex(CELL_INDEX, CELL_INDEX, { unique: false });
      }
      if (!db.objectStoreNames.contains(KEYS_STORE)) {
        db.createObjectStore(KEYS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("presence database failed to open"));
    request.onblocked = () =>
      reject(new Error("presence database upgrade is blocked"));
  });
}

async function loadOrCreateKey(
  db: IDBDatabase,
  cryptoApi: Pick<Crypto, "getRandomValues" | "subtle">,
): Promise<CryptoKey> {
  const read = db.transaction(KEYS_STORE, "readonly");
  const existing = await requestResult(
    read.objectStore(KEYS_STORE).get(JOURNAL_KEY_ID) as IDBRequest<
      CryptoKey | undefined
    >,
  );
  if (existing !== undefined) {
    return existing;
  }

  const created = await generateJournalKey(cryptoApi.subtle);
  const write = db.transaction(KEYS_STORE, "readwrite");
  // put, not add: two tabs opening the journal for the first time at once both
  // reach here, and the loser adopting the winner's key is the only outcome
  // that leaves one readable journal.
  write.objectStore(KEYS_STORE).put(created, JOURNAL_KEY_ID);
  await transactionDone(write);

  const confirm = db.transaction(KEYS_STORE, "readonly");
  const settled = await requestResult(
    confirm.objectStore(KEYS_STORE).get(JOURNAL_KEY_ID) as IDBRequest<
      CryptoKey | undefined
    >,
  );
  return settled ?? created;
}

/**
 * The local visit journal.
 *
 * Append-only and encrypted on write. Open key questions, deliberately not
 * answered in Phase 1 and not to be assumed by anything reading this: there is
 * no key rotation, no export or backup path, and no binding of the journal key
 * to an identity key. Clearing site data destroys the journal, and that is
 * currently the only way to erase it.
 */
export function createPresenceIdbStore(
  environment: PresenceIdbEnvironment,
): PresenceIdbStore {
  const databaseName = environment.databaseName ?? PRESENCE_DATABASE_NAME;
  const listeners = new Set<(record: VisitRecord) => void>();
  let closed = false;
  let opened: Promise<{ db: IDBDatabase; cipher: JournalCipher }> | undefined;

  function ready(): Promise<{ db: IDBDatabase; cipher: JournalCipher }> {
    opened ??= (async () => {
      const db = await openDatabase(environment.indexedDB, databaseName);
      const key = await loadOrCreateKey(db, environment.crypto);
      return { db, cipher: createJournalCipher(key, environment.crypto) };
    })().catch((error: unknown) => {
      // A failed open must not be cached as a permanent failure: a later call
      // deserves a fresh attempt rather than the first error forever.
      opened = undefined;
      throw error;
    });
    return opened;
  }

  return {
    async append(record) {
      const { db, cipher } = await ready();
      const sealed = await cipher.seal(record);
      const transaction = db.transaction(VISITS_STORE, "readwrite");
      transaction.objectStore(VISITS_STORE).add(sealed);
      await transactionDone(transaction);

      for (const listener of [...listeners]) {
        listener(record);
      }
    },

    async listCells() {
      const { db } = await ready();
      const transaction = db.transaction(VISITS_STORE, "readonly");
      // Walked off the plaintext index, one step per distinct cell rather than
      // one per visit, and decrypting nothing at all. That is what keeps a map
      // load independent of how long the journal has grown.
      //
      // "nextunique" is doing the real work here: a key cursor over the index
      // would otherwise stop at every visit, and getAllKeys on an index yields
      // the visits' primary keys, not the cells.
      const cursorRequest = transaction
        .objectStore(VISITS_STORE)
        .index(CELL_INDEX)
        .openKeyCursor(null, "nextunique");
      const cells: CellIndex[] = [];

      await new Promise<void>((resolve, reject) => {
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor === null) {
            resolve();
            return;
          }
          if (typeof cursor.key === "string") {
            cells.push(cursor.key);
          }
          cursor.continue();
        };
        cursorRequest.onerror = () =>
          reject(cursorRequest.error ?? new Error("cell scan failed"));
      });

      return cells;
    },

    async recordsForCell(cell) {
      const { db, cipher } = await ready();
      const transaction = db.transaction(VISITS_STORE, "readonly");
      const sealed = await requestResult(
        transaction
          .objectStore(VISITS_STORE)
          .index(CELL_INDEX)
          .getAll(cell) as IDBRequest<SealedVisit[]>,
      );
      return Promise.all(sealed.map((row) => cipher.open(row)));
    },

    subscribe(onAppend) {
      listeners.add(onAppend);
      return () => {
        listeners.delete(onAppend);
      };
    },

    close() {
      if (closed) {
        return;
      }
      closed = true;
      listeners.clear();
      const pending = opened;
      opened = undefined;
      void pending?.then(({ db }) => db.close()).catch(() => undefined);
    },
  };
}
