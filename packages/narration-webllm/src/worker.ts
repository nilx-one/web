// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** The model runs here so that narration never occupies the frame the map is drawing. */

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();

globalThis.onmessage = (event: MessageEvent) => {
  handler.onmessage(event);
};
