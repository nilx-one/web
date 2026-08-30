// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreRuntimePort, CoreRuntimeStatus } from "@nilx-one/application";

export interface CoreWasmBindings {
  contractVersion(): string;
}

export type CoreWasmBindingsLoader = () => Promise<CoreWasmBindings>;

export interface CoreWasmClientOptions {
  loadBindings?: CoreWasmBindingsLoader;
}

class CoreWasmClient implements CoreRuntimePort {
  public constructor(private readonly options: CoreWasmClientOptions) {}

  public async probe(): Promise<CoreRuntimeStatus> {
    if (this.options.loadBindings === undefined) {
      return {
        kind: "unavailable",
        reason: "artifact-missing",
      };
    }

    try {
      const bindings = await this.options.loadBindings();
      const contractVersion = bindings.contractVersion().trim();

      if (contractVersion.length === 0) {
        return {
          kind: "unavailable",
          reason: "binding-invalid",
        };
      }

      return {
        kind: "ready",
        contractVersion,
      };
    } catch {
      return {
        kind: "unavailable",
        reason: "load-failed",
      };
    }
  }
}

export function createCoreWasmClient(
  options: CoreWasmClientOptions = {},
): CoreRuntimePort {
  return new CoreWasmClient(options);
}
