// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  ReadAvaiaProfile,
  UpdateAvaiaProfile,
  type AvaiaProfileProjection,
  type AvaiaProfileReadResult,
  type AvaiaProfileUpdateResult,
} from "@nilx-one/application";
import { useEffect, useState } from "react";

import { useAvaiaProfileAccess } from "./avaia-profile-context";

export type AvaiaProfileLoadState =
  | { kind: "unsupported" }
  | { kind: "loading" }
  | AvaiaProfileReadResult;

export interface AvaiaProfileController {
  readonly load: AvaiaProfileLoadState;
  readonly profile: AvaiaProfileProjection | undefined;
  readonly saving: boolean;
  readonly saveResult: AvaiaProfileUpdateResult | undefined;
  save(pubDress: string): Promise<AvaiaProfileUpdateResult>;
  resetSave(): void;
}

/**
 * Local cached projection of identity contract 8. The service owns validation
 * and ownership. A successful write replaces this projection immediately with
 * the exact response before any later read is required.
 */
export function useAvaiaProfile(ownerPubDress: string): AvaiaProfileController {
  const access = useAvaiaProfileAccess();
  const [load, setLoad] = useState<AvaiaProfileLoadState>({
    kind: "unsupported",
  });
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<
    AvaiaProfileUpdateResult | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    setSaveResult(undefined);
    if (access === undefined) {
      setLoad({ kind: "unsupported" });
      return () => {
        cancelled = true;
      };
    }

    setLoad({ kind: "loading" });
    void new ReadAvaiaProfile(access).execute().then((result) => {
      if (!cancelled) setLoad(result);
    });
    return () => {
      cancelled = true;
    };
  }, [access, ownerPubDress]);

  const profile = load.kind === "available" ? load.profile : undefined;

  async function save(pubDress: string): Promise<AvaiaProfileUpdateResult> {
    if (access === undefined) {
      const result: AvaiaProfileUpdateResult = {
        kind: "service-unavailable",
      };
      setSaveResult(result);
      return result;
    }

    setSaving(true);
    setSaveResult(undefined);
    const result = await new UpdateAvaiaProfile(access).execute(pubDress);
    if (result.kind === "updated") {
      setLoad({ kind: "available", profile: result.profile });
    }
    setSaveResult(result);
    setSaving(false);
    return result;
  }

  return {
    load,
    profile,
    saving,
    saveResult,
    save,
    resetSave: () => setSaveResult(undefined),
  };
}
