// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { expect, it } from "vitest";

import { hasSeedsWalletAccess } from "./seeds-wallet";

it("recognises a wallet port only by its read", () => {
  expect(hasSeedsWalletAccess({ readSeedsWallet: async () => undefined })).toBe(
    true,
  );
  expect(hasSeedsWalletAccess({})).toBe(false);
  expect(hasSeedsWalletAccess(undefined)).toBe(false);
});
