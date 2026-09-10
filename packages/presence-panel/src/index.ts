// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  toJournalRows,
  type CellIndex,
  type PresenceStore,
} from "@nilx-one/presence-contract";

/**
 * The journal, shown raw.
 *
 * Deliberately plain. Phase 1 exists to put real captured journal output in
 * front of a person and let them decide whether it is worth narrating at all;
 * dressing it up would answer that question before it has been asked. Nothing
 * here interprets a visit or infers what a place meant.
 *
 * This is also the only path from a lit cell to journal text. The renderer is
 * given cell membership and no way to read a record, so a tap arriving here
 * with a cell index is what opens the journal.
 */

export const PANEL_CLASS = "presence-journal";

export interface PresenceJournalPanel {
  /** Reads and shows every record for one cell. */
  show(cell: CellIndex): Promise<void>;
  hide(): void;
  readonly element: HTMLElement;
  destroy(): void;
}

const COLUMNS = [
  ["entered", "entered"],
  ["left", "left"],
  ["dwell", "dwell"],
  ["fixes", "fixes"],
  ["bestAccuracy", "best fix"],
] as const;

export function createPresenceJournalPanel(
  store: PresenceStore,
  document_: Document = document,
): PresenceJournalPanel {
  const element = document_.createElement("section");
  element.className = PANEL_CLASS;
  element.hidden = true;

  const heading = document_.createElement("header");
  heading.className = `${PANEL_CLASS}__heading`;

  const title = document_.createElement("h2");
  title.textContent = "visits";

  const cellLabel = document_.createElement("code");
  cellLabel.className = `${PANEL_CLASS}__cell`;

  const close = document_.createElement("button");
  close.type = "button";
  close.textContent = "close";
  close.setAttribute("aria-label", "Close the visit journal");

  heading.append(title, cellLabel, close);

  const body = document_.createElement("div");
  body.className = `${PANEL_CLASS}__body`;

  element.append(heading, body);

  // A live region: a tap replaces the contents in place, and a screen reader
  // is told what appeared rather than being left on a silently changed panel.
  element.setAttribute("aria-live", "polite");

  let generation = 0;

  function hide(): void {
    element.hidden = true;
    body.replaceChildren();
  }

  close.addEventListener("click", hide);

  function renderRows(rows: ReturnType<typeof toJournalRows>): void {
    body.replaceChildren();

    if (rows.length === 0) {
      const empty = document_.createElement("p");
      empty.textContent = "no records";
      body.append(empty);
      return;
    }

    const table = document_.createElement("table");
    const head = document_.createElement("thead");
    const headRow = document_.createElement("tr");
    for (const [, label] of COLUMNS) {
      const cell = document_.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headRow.append(cell);
    }
    head.append(headRow);

    const bodyRows = document_.createElement("tbody");
    for (const row of rows) {
      const tableRow = document_.createElement("tr");
      for (const [key] of COLUMNS) {
        const cell = document_.createElement("td");
        cell.textContent = row[key];
        tableRow.append(cell);
      }
      bodyRows.append(tableRow);
    }

    table.append(head, bodyRows);
    body.append(table);
  }

  return {
    element,

    async show(cell) {
      generation += 1;
      const mine = generation;
      cellLabel.textContent = cell;
      element.hidden = false;
      body.replaceChildren();

      let rows: ReturnType<typeof toJournalRows>;
      try {
        rows = toJournalRows(await store.recordsForCell(cell));
      } catch {
        // A journal that will not open says so, rather than leaving the panel
        // showing the previous cell's visits under this cell's name.
        if (mine !== generation) return;
        const failed = document_.createElement("p");
        failed.textContent = "the journal could not be read";
        body.replaceChildren(failed);
        return;
      }

      // A second tap while this read was in flight already won.
      if (mine !== generation) {
        return;
      }
      renderRows(rows);
    },

    hide,

    destroy() {
      close.removeEventListener("click", hide);
      element.remove();
    },
  };
}
