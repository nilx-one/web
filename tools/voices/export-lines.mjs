// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// Prints every fixed line an Avaia says, as JSON, for render.py to voice.
// The catalog is read from the TypeScript source itself, so nothing is copied
// and a line changed there is a line render.py sees changed.
//
//   node --experimental-strip-types tools/voices/export-lines.mjs

import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const { avaiaLines } =
  await import("../../packages/product-app/src/features/map/avaia-lines.ts");

// Lines about a landmark carry its name, which only the moment knows; they
// are not rendered ahead of time.
const FIXED_KINDS = [
  "walk",
  "blocked.building",
  "blocked.water",
  "blocked.fog",
  "fog.reveal",
  "fog.revealed",
  "fog.busy",
];

const voices = JSON.parse(
  readFileSync(new URL("./voices.json", import.meta.url), "utf8"),
);

const lines = [];
for (const [locale, voice] of Object.entries(voices.locales)) {
  for (const study of Object.keys(voice.studies)) {
    for (const kind of FIXED_KINDS) {
      avaiaLines(locale, study, kind).forEach((text, index) => {
        lines.push({ locale, study, kind, index, text });
      });
    }
  }
}

process.stdout.write(`${JSON.stringify(lines, null, 2)}\n`);
