// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export type GraphicsBackend = "webgpu" | "webgl2" | "unsupported";

export interface GraphicsCapabilities {
  requestWebGpuAdapter?: () => Promise<unknown | null>;
  createWebGl2Context: () => unknown | null;
}

export interface GraphicsBackendSelection {
  backend: GraphicsBackend;
  webGpuAttempted: boolean;
}

export async function selectGraphicsBackend(
  capabilities: GraphicsCapabilities,
): Promise<GraphicsBackendSelection> {
  if (capabilities.requestWebGpuAdapter !== undefined) {
    try {
      const adapter = await capabilities.requestWebGpuAdapter();

      if (adapter !== null) {
        return {
          backend: "webgpu",
          webGpuAttempted: true,
        };
      }
    } catch {
      // Adapter acquisition failure follows the same explicit fallback path.
    }
  }

  if (capabilities.createWebGl2Context() !== null) {
    return {
      backend: "webgl2",
      webGpuAttempted: capabilities.requestWebGpuAdapter !== undefined,
    };
  }

  return {
    backend: "unsupported",
    webGpuAttempted: capabilities.requestWebGpuAdapter !== undefined,
  };
}

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter(): Promise<unknown | null>;
  };
}

export function createBrowserGraphicsCapabilities(
  browserNavigator: NavigatorWithGpu,
  browserDocument: Document,
): GraphicsCapabilities {
  const requestWebGpuAdapter = browserNavigator.gpu?.requestAdapter.bind(
    browserNavigator.gpu,
  );

  return {
    ...(requestWebGpuAdapter === undefined ? {} : { requestWebGpuAdapter }),
    createWebGl2Context: () =>
      browserDocument.createElement("canvas").getContext("webgl2"),
  };
}
