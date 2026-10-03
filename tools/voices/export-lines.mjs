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
const { GUIDE_NODES } =
  await import("../../packages/product-app/src/features/guide/guide-script.ts");
const catalogs = await import(
  "../../packages/product-app/src/shell/messages/guide.ts"
);

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
        lines.push({ locale, character: "avaia", study, kind, index, text });
      });
    }
  }
}

// xSasha's lines, in the voice of every gender she can be drawn in. A
// wording the language marks for gender is rendered only in its own voice;
// an unmarked one in each. The Bond's replies are never voiced.
const GUIDE_CATALOGS = { en: catalogs.GUIDE_EN, "uk-UA": catalogs.GUIDE_UK };
for (const [locale, voice] of Object.entries(voices.locales)) {
  const catalog = GUIDE_CATALOGS[locale];
  if (catalog === undefined || voice.xsasha === undefined) continue;
  for (const gender of Object.keys(voice.xsasha)) {
    for (const node of Object.values(GUIDE_NODES)) {
      for (const wording of node.line) {
        const key = typeof wording === "string" ? wording : wording[gender];
        lines.push({
          locale,
          character: "xsasha",
          voice: gender,
          key,
          text: catalog[key],
        });
      }
    }
  }
}

process.stdout.write(`${JSON.stringify(lines, null, 2)}\n`);
