// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // `@aiaiaiai/webllm` starts its worker from `new URL("./webllm-worker.js",
    // import.meta.url)`. Pre-bundling moves the module away from that file, so the dev
    // server would resolve the worker against the wrong directory.
    exclude: ["@aiaiaiai/webllm"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
