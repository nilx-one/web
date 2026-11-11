// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanup } from "@testing-library/react";
import { installWalkGraphCore, type WalkGraphCore } from "@nilx-one/walk-graph";
import { afterEach } from "vitest";

// Core is the head: the walking graph is Core's, never a copy in Web. Tests
// run against the verified runtime `scripts/prepare_core_wasm_runtime.sh`
// puts in every host, as CI prepares it before the tests.
const coreRuntime = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../apps/site/public/core/0.1.0",
);
if (!existsSync(join(coreRuntime, "index_bg.wasm")))
  throw new Error(
    "The Core Wasm runtime is not prepared: run scripts/prepare_core_wasm_runtime.sh with a checkout of the pinned nilx-one/core first.",
  );
const runtime = (await import(
  /* @vite-ignore */ pathToFileURL(join(coreRuntime, "index.js")).href
)) as WalkGraphCore & { initSync(input: { module: Uint8Array }): unknown };
runtime.initSync({ module: readFileSync(join(coreRuntime, "index_bg.wasm")) });
installWalkGraphCore(runtime);

window.scrollTo = () => undefined;
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => cleanup());
