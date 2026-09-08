// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  hasAvaiaProfileAccess,
  type AvaiaProfileAccessPort,
  type IdentityAccessPort,
} from "@nilx-one/application";
import { createContext, useContext, type ReactNode } from "react";

const AvaiaProfileContext = createContext<AvaiaProfileAccessPort | undefined>(
  undefined,
);

export function AvaiaProfileProvider({
  identity,
  children,
}: {
  readonly identity: IdentityAccessPort;
  readonly children: ReactNode;
}) {
  return (
    <AvaiaProfileContext.Provider
      value={hasAvaiaProfileAccess(identity) ? identity : undefined}
    >
      {children}
    </AvaiaProfileContext.Provider>
  );
}

export function useAvaiaProfileAccess(): AvaiaProfileAccessPort | undefined {
  return useContext(AvaiaProfileContext);
}
