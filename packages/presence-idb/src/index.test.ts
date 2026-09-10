// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { VisitRecord } from "@nilx-one/presence-contract";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CELL_INDEX,
  JOURNAL_KEY_ID,
  KEYS_STORE,
  VISITS_STORE,
  createPresenceIdbStore,
  type PresenceIdbEnvironment,
  type SealedVisit,
} from "./index";

const CELL_A = "891f1d48a83ffff";
const CELL_B = "891f1d48a87ffff";

function visit(overrides: Partial<VisitRecord> = {}): VisitRecord {
  return {
    cell: CELL_A,
    enteredAt: 1_700_000_000_000,
    leftAt: null,
    source: "self",
    fixCount: 3,
    bestAccuracyM: 14.5,
    ...overrides,
  };
}

let environment: PresenceIdbEnvironment;

beforeEach(() => {
  environment = {
    indexedDB: new IDBFactory(),
    crypto: globalThis.crypto,
    databaseName: `presence-test-${Math.random().toString(36).slice(2)}`,
  };
});

function openRaw(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = environment.indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rawVisits(name: string): Promise<SealedVisit[]> {
  const db = await openRaw(name);
  return new Promise<SealedVisit[]>((resolve, reject) => {
    const request = db
      .transaction(VISITS_STORE, "readonly")
      .objectStore(VISITS_STORE)
      .getAll() as IDBRequest<SealedVisit[]>;
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("presence journal", () => {
  it("reads back what it appended", async () => {
    const store = createPresenceIdbStore(environment);
    const record = visit();

    await store.append(record);

    expect(await store.recordsForCell(CELL_A)).toEqual([record]);
  });

  it("keeps every visit to a cell rather than replacing the last", async () => {
    const store = createPresenceIdbStore(environment);
    await store.append(visit({ enteredAt: 1, leftAt: 2 }));
    await store.append(visit({ enteredAt: 10, leftAt: 20 }));

    const records = await store.recordsForCell(CELL_A);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.enteredAt).sort()).toEqual([1, 10]);
  });

  it("lists each visited cell once", async () => {
    const store = createPresenceIdbStore(environment);
    await store.append(visit({ cell: CELL_A }));
    await store.append(visit({ cell: CELL_A, enteredAt: 2 }));
    await store.append(visit({ cell: CELL_B }));

    expect([...(await store.listCells())].sort()).toEqual(
      [CELL_A, CELL_B].sort(),
    );
  });

  it("lists no cells for an untouched journal", async () => {
    const store = createPresenceIdbStore(environment);

    expect(await store.listCells()).toEqual([]);
  });

  it("returns nothing for a cell never visited", async () => {
    const store = createPresenceIdbStore(environment);
    await store.append(visit({ cell: CELL_A }));

    expect(await store.recordsForCell(CELL_B)).toEqual([]);
  });

  it("notifies subscribers on append and stops on unsubscribe", async () => {
    const store = createPresenceIdbStore(environment);
    const seen: VisitRecord[] = [];
    const unsubscribe = store.subscribe((record) => seen.push(record));

    await store.append(visit({ cell: CELL_A }));
    unsubscribe();
    await store.append(visit({ cell: CELL_B }));

    expect(seen.map((record) => record.cell)).toEqual([CELL_A]);
  });

  it("survives a reopen, so the journal outlives the page", async () => {
    const first = createPresenceIdbStore(environment);
    await first.append(visit({ enteredAt: 7, leftAt: 9 }));
    first.close();

    const second = createPresenceIdbStore(environment);
    const records = await second.recordsForCell(CELL_A);

    expect(records).toHaveLength(1);
    expect(records[0]?.enteredAt).toBe(7);
  });
});

describe("what a journal row actually holds", () => {
  it("writes the cell in the clear and everything else as ciphertext", async () => {
    const name = environment.databaseName ?? "";
    const store = createPresenceIdbStore(environment);
    await store.append(visit({ enteredAt: 1_700_000_000_000 }));

    const [row] = await rawVisits(name);

    expect(row?.cell).toBe(CELL_A);
    expect(row?.iv).toHaveLength(12);
    expect(Object.keys(row ?? {}).sort()).toEqual(["cell", "ciphertext", "iv"]);
  });

  it("leaves no timestamp, fix count, or accuracy readable on disk", async () => {
    const name = environment.databaseName ?? "";
    const store = createPresenceIdbStore(environment);
    await store.append(
      visit({ enteredAt: 1_700_000_000_000, fixCount: 42, bestAccuracyM: 7 }),
    );

    const [row] = await rawVisits(name);
    const onDisk = new TextDecoder().decode(
      new Uint8Array(row?.ciphertext ?? new ArrayBuffer(0)),
    );

    expect(onDisk).not.toContain("1700000000000");
    expect(onDisk).not.toContain("enteredAt");
    expect(onDisk).not.toContain("42");
    expect(onDisk).not.toContain("self");
  });

  it("gives every record its own nonce", async () => {
    const name = environment.databaseName ?? "";
    const store = createPresenceIdbStore(environment);
    await store.append(visit());
    await store.append(visit());

    const rows = await rawVisits(name);
    const nonces = rows.map((row) => [...row.iv].join(","));

    expect(new Set(nonces).size).toBe(2);
  });

  it("stores a key that cannot be exported back to material", async () => {
    const name = environment.databaseName ?? "";
    const store = createPresenceIdbStore(environment);
    await store.append(visit());
    const db = await openRaw(name);

    const key = await new Promise<CryptoKey>((resolve, reject) => {
      const request = db
        .transaction(KEYS_STORE, "readonly")
        .objectStore(KEYS_STORE)
        .get(JOURNAL_KEY_ID) as IDBRequest<CryptoKey>;
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("refuses to open a row whose plaintext cell was edited underneath it", async () => {
    const name = environment.databaseName ?? "";
    const store = createPresenceIdbStore(environment);
    await store.append(visit({ cell: CELL_A }));

    const db = await openRaw(name);
    const [row] = await rawVisits(name);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(VISITS_STORE, "readwrite");
      const objectStore = transaction.objectStore(VISITS_STORE);
      const cursorRequest = objectStore.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) return;
        cursor.update({ ...row, cell: CELL_B });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const reopened = createPresenceIdbStore(environment);
    await expect(reopened.recordsForCell(CELL_B)).rejects.toThrow();
  });
});

describe("the index the shader depends on", () => {
  it("indexes visits by cell", async () => {
    const name = environment.databaseName ?? "";
    const store = createPresenceIdbStore(environment);
    await store.append(visit());
    const db = await openRaw(name);

    const index = db
      .transaction(VISITS_STORE, "readonly")
      .objectStore(VISITS_STORE)
      .index(CELL_INDEX);

    expect(index.keyPath).toBe("cell");
    expect(index.unique).toBe(false);
  });

  it("answers listCells without decrypting anything", async () => {
    const decrypt = vi.spyOn(globalThis.crypto.subtle, "decrypt");
    const store = createPresenceIdbStore(environment);
    await store.append(visit({ cell: CELL_A }));
    await store.append(visit({ cell: CELL_B }));
    decrypt.mockClear();

    await store.listCells();

    expect(decrypt).not.toHaveBeenCalled();
  });
});
