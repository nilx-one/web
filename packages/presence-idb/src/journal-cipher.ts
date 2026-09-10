// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CellIndex, VisitRecord } from "@nilx-one/presence-contract";

/** AES-GCM's nonce size. 96 bits is the size the mode is specified around. */
export const IV_BYTES = 12;

export const JOURNAL_KEY_ALGORITHM = "AES-GCM";
export const JOURNAL_KEY_LENGTH = 256;

/**
 * What a row holds. The cell is deliberately in the clear: `listCells()` runs
 * on every map load, and decrypting the whole journal to answer it would put a
 * full decrypt inside a frame budget. Encrypting it would also protect very
 * little — cell membership is precisely what the shader paints on screen. What
 * stays encrypted is the part the screen never shows: when a person was there,
 * for how long, how often, and how sure the device was.
 */
export interface SealedVisit {
  readonly cell: CellIndex;
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ciphertext: ArrayBuffer;
}

/** The encrypted half of a visit: everything except the cell. */
interface VisitPayload {
  readonly enteredAt: number;
  readonly leftAt: number | null;
  readonly source: VisitRecord["source"];
  readonly fixCount: number;
  readonly bestAccuracyM: number;
}

export interface JournalCipher {
  seal(record: VisitRecord): Promise<SealedVisit>;
  open(sealed: SealedVisit): Promise<VisitRecord>;
}

/**
 * Copied into a buffer of its own so the result is a plain ArrayBuffer view.
 * WebCrypto's types reject the possibly-shared buffer a TextEncoder returns.
 */
function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

function encodeCell(cell: CellIndex): Uint8Array<ArrayBuffer> {
  return encodeUtf8(cell);
}

/**
 * Generates the journal key.
 *
 * `extractable: false` is the point of the whole arrangement: a non-extractable
 * CryptoKey is structured-cloneable, so it can live in IndexedDB and be used
 * for years, while the key material itself never exists as bytes in JS and so
 * can never be read out by page script, an extension, or a later bug.
 */
export async function generateJournalKey(
  subtle: SubtleCrypto,
): Promise<CryptoKey> {
  return subtle.generateKey(
    { name: JOURNAL_KEY_ALGORITHM, length: JOURNAL_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

export function createJournalCipher(
  key: CryptoKey,
  cryptoApi: Pick<Crypto, "getRandomValues" | "subtle">,
): JournalCipher {
  return {
    async seal(record) {
      const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
      const payload: VisitPayload = {
        enteredAt: record.enteredAt,
        leftAt: record.leftAt,
        source: record.source,
        fixCount: record.fixCount,
        bestAccuracyM: record.bestAccuracyM,
      };
      const ciphertext = await cryptoApi.subtle.encrypt(
        {
          name: JOURNAL_KEY_ALGORITHM,
          iv,
          // The plaintext cell column is authenticated, so a row whose cell was
          // edited underneath its ciphertext fails to open rather than reading
          // back as a visit somewhere the person never was.
          additionalData: encodeCell(record.cell),
        },
        key,
        encodeUtf8(JSON.stringify(payload)),
      );
      return { cell: record.cell, iv, ciphertext };
    },

    async open(sealed) {
      const plaintext = await cryptoApi.subtle.decrypt(
        {
          name: JOURNAL_KEY_ALGORITHM,
          iv: sealed.iv,
          additionalData: encodeCell(sealed.cell),
        },
        key,
        sealed.ciphertext,
      );
      const payload = JSON.parse(
        new TextDecoder().decode(plaintext),
      ) as VisitPayload;
      return {
        cell: sealed.cell,
        enteredAt: payload.enteredAt,
        leftAt: payload.leftAt,
        source: payload.source,
        fixCount: payload.fixCount,
        bestAccuracyM: payload.bestAccuracyM,
      };
    },
  };
}
