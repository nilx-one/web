// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
} from "@nilx-one/core-wasm";
import {
  createTelegramHost,
  resolveTelegramWebApp,
} from "@nilx-one/host-telegram";
import { ProductApp } from "@nilx-one/product-app";
import "@nilx-one/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.querySelector<HTMLElement>("#root");

if (container === null) {
  throw new Error("0x1 root element is missing");
}

const host = createTelegramHost(resolveTelegramWebApp(window));
const core = createCoreWasmClient({
  loadBindings: loadGeneratedCoreWasmBindings,
});

createRoot(container).render(
  <StrictMode>
    <ProductApp core={core} host={host} />
  </StrictMode>,
);
