// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { formatRecords, type CellTap } from "./pick";

export interface RawJournalPresenter {
  show(tap: CellTap): void;
  dispose(): void;
}

/** Phase 1 only: intentionally plain raw journal rows, not narration. */
export function createRawJournalPresenter(
  document: Document = globalThis.document,
): RawJournalPresenter {
  const panel = document.createElement("aside");
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Presence journal");
  panel.style.cssText =
    "position:fixed;z-index:40;top:72px;right:12px;max-width:min(560px,calc(100vw - 24px));max-height:45vh;overflow:auto;padding:12px 40px 12px 12px;border:1px solid rgba(127,127,127,.35);border-radius:12px;background:rgba(20,20,24,.92);color:#f5f5f2;box-shadow:0 10px 35px rgba(0,0,0,.25);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap";

  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close presence journal");
  close.textContent = "×";
  close.style.cssText =
    "position:absolute;top:6px;right:8px;border:0;background:transparent;color:inherit;font:20px/1 system-ui;cursor:pointer";
  close.addEventListener("click", () => {
    panel.hidden = true;
  });

  const body = document.createElement("pre");
  body.style.cssText = "margin:0;white-space:pre-wrap;word-break:break-word";
  panel.append(close, body);
  document.body.append(panel);

  return {
    show(tap) {
      body.textContent = [tap.cell, "", ...formatRecords(tap.records)].join("\n");
      panel.hidden = false;
    },
    dispose() {
      panel.remove();
    },
  };
}
