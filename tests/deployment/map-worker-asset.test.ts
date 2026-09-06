// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { basename, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { build } from "vite";

// MapLibre runs its tile pipeline in a worker it resolves from its own module
// URL. An application build inlines the library into an application chunk, so
// that default names a file the deployment never publishes: the worker never
// starts, every source waits on it, and the map fails on the load timeout with
// no error of its own. The renderer therefore binds a worker URL the build
// emits, and this proves the built application actually publishes that file.
interface EmittedFile {
  readonly fileName: string;
  readonly code?: string;
}

async function emittedFiles(app: string): Promise<readonly EmittedFile[]> {
  const result = await build({
    root: resolve(app),
    logLevel: "silent",
    build: { write: false, sourcemap: false },
  });

  const bundles = Array.isArray(result) ? result : [result];
  return bundles.flatMap(
    (bundle) => (bundle as unknown as { output: EmittedFile[] }).output,
  );
}

describe.each([
  ["apps/site"],
  ["apps/telegram-mini-app"],
  ["apps/discord-activity"],
])("%s published map renderer worker", (app) => {
  it("publishes the MapLibre worker and binds it from the application chunk", async () => {
    const files = await emittedFiles(app);
    const workers = files.filter((file) =>
      /maplibre-gl-worker.*\.js$/.test(file.fileName),
    );

    expect(workers).toHaveLength(1);

    // A relative base publishes the worker URL as a bare file name resolved
    // against the application chunk, so the emitted name is what both bases
    // have in common.
    const workerFileName = workers[0]?.fileName ?? "";
    const referencing = files.filter(
      (file) =>
        file.fileName !== workerFileName &&
        file.code !== undefined &&
        file.code.includes(basename(workerFileName)),
    );

    expect(referencing.length).toBeGreaterThan(0);
  }, 120_000);
});
