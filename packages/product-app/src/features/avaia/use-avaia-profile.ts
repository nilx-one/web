// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  ReadAvaiaProfile,
  UpdateAvaiaProfile,
  type AvaiaProfileAccessPort,
  type AvaiaProfileProjection,
  type AvaiaProfileReadResult,
  type AvaiaProfileUpdateResult,
} from "@nilx-one/application";
import { useEffect, useState } from "react";

import { useAvaiaProfileAccess } from "./avaia-profile-context";

export type AvaiaProfileLoadState =
  { kind: "unsupported" } | { kind: "loading" } | AvaiaProfileReadResult;

export interface AvaiaProfileController {
  readonly load: AvaiaProfileLoadState;
  readonly profile: AvaiaProfileProjection | undefined;
  readonly saving: boolean;
  readonly saveResult: AvaiaProfileUpdateResult | undefined;
  save(pubDress: string): Promise<AvaiaProfileUpdateResult>;
  resetSave(): void;
}

interface AvaiaProfileReadSnapshot {
  readonly access: AvaiaProfileAccessPort;
  readonly ownerPubDress: string;
  readonly result: AvaiaProfileReadResult;
}

interface AvaiaProfileSaveSnapshot {
  readonly access: AvaiaProfileAccessPort;
  readonly ownerPubDress: string;
  readonly result: AvaiaProfileUpdateResult;
}

interface AvaiaProfileRequestKey {
  readonly access: AvaiaProfileAccessPort;
  readonly ownerPubDress: string;
}

function matchesRequest(
  key: AvaiaProfileRequestKey | undefined,
  access: AvaiaProfileAccessPort | undefined,
  ownerPubDress: string,
): boolean {
  return key?.access === access && key.ownerPubDress === ownerPubDress;
}

/**
 * Local cached projection of identity contract 8. The service owns validation
 * and ownership. A successful write replaces this projection immediately with
 * the exact response before any later read is required.
 */
export function useAvaiaProfile(ownerPubDress: string): AvaiaProfileController {
  const access = useAvaiaProfileAccess();
  const [readSnapshot, setReadSnapshot] = useState<
    AvaiaProfileReadSnapshot | undefined
  >(undefined);
  const [savingFor, setSavingFor] = useState<
    AvaiaProfileRequestKey | undefined
  >(undefined);
  const [saveSnapshot, setSaveSnapshot] = useState<
    AvaiaProfileSaveSnapshot | undefined
  >(undefined);

  useEffect(() => {
    if (access === undefined) return;

    let cancelled = false;
    const request = { access, ownerPubDress };
    void new ReadAvaiaProfile(access).execute().then((result) => {
      if (cancelled) return;
      setReadSnapshot({ ...request, result });
    });
    return () => {
      cancelled = true;
    };
  }, [access, ownerPubDress]);

  const load: AvaiaProfileLoadState =
    access === undefined
      ? { kind: "unsupported" }
      : matchesRequest(readSnapshot, access, ownerPubDress)
        ? readSnapshot.result
        : { kind: "loading" };
  const profile = load.kind === "available" ? load.profile : undefined;
  const saving = matchesRequest(savingFor, access, ownerPubDress);
  const saveResult = matchesRequest(saveSnapshot, access, ownerPubDress)
    ? saveSnapshot.result
    : undefined;

  async function save(pubDress: string): Promise<AvaiaProfileUpdateResult> {
    if (access === undefined) {
      return { kind: "service-unavailable" };
    }

    const request = { access, ownerPubDress };
    setSavingFor(request);
    setSaveSnapshot(undefined);
    const result = await new UpdateAvaiaProfile(access).execute(pubDress);
    if (result.kind === "updated") {
      setReadSnapshot({
        ...request,
        result: { kind: "available", profile: result.profile },
      });
    }
    setSaveSnapshot({ ...request, result });
    setSavingFor(undefined);
    return result;
  }

  return {
    load,
    profile,
    saving,
    saveResult,
    save,
    resetSave: () => setSaveSnapshot(undefined),
  };
}
