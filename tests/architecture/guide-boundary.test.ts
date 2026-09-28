// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GUIDE = join(ROOT, "packages/product-app/src/features/guide");
const HOME = join(
  ROOT,
  "packages/product-app/src/features/map/authenticated-map-home-view.tsx",
);

/**
 * xSasha is presentation and guidance. What she may read and write is
 * pinned here, so a scene can never quietly become a second protocol: she
 * reads the published avatar scene, the camera and the local copy, and keeps
 * one play record of her own. Identity, BondChain, presence, pub_info and the
 * runtime are out of her reach.
 */
const ALLOWED_IMPORTS = new Set([
  "react",
  "@nilx-one/map-contract",
  "@nilx-one/application",
  "../../shell/localization",
  "../progression/progression",
  "../progression/achievement-dialog",
]);

/** Of the application, only the resolver that says what a body wears. */
const ALLOWED_APPLICATION_NAMES = new Set(["resolveAvatarScene"]);

/** Anything here would let a scene write state it does not own. */
const FORBIDDEN_CALLS = [
  "updateProgression",
  "queueExperience",
  "earnDeviceAchievement",
  "markSettingsHintSeen",
  "fetch(",
  "XMLHttpRequest",
  "publish",
  "onPrepareAvaia",
  "onAvaiaSetupSubmit",
  "updateAvaiaProfile",
  "chooseAvatarModel",
  "commitAvatar",
];

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function guideSources(): { file: string; code: string }[] {
  return readdirSync(GUIDE)
    .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
    .map((entry) => ({
      file: entry,
      code: withoutComments(readFileSync(join(GUIDE, entry), "utf8")),
    }));
}

/** The body of a function declared in the home view, braces balanced. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} is not declared.`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`${name} never closes.`);
}

describe("xSasha stays presentation", () => {
  it("imports nothing that could write identity, presence or protocol state", () => {
    const violations: string[] = [];
    for (const { file, code } of guideSources()) {
      for (const match of code.matchAll(
        /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g,
      )) {
        const from = match[3] ?? match[4] ?? "";
        if (from.startsWith("./")) continue;
        if (!ALLOWED_IMPORTS.has(from)) {
          violations.push(`${file}: ${from}`);
          continue;
        }
        if (from === "@nilx-one/application" && match[1] === undefined) {
          const names = (match[2] ?? "")
            .split(",")
            .map((name) => name.trim().replace(/^type\s+/, ""))
            .filter((name) => name.length > 0 && !name.startsWith("type "));
          for (const name of names) {
            if (!ALLOWED_APPLICATION_NAMES.has(name)) {
              violations.push(`${file}: ${name} from ${from}`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("calls nothing that writes state a scene does not own", () => {
    const violations = guideSources().flatMap(({ file, code }) =>
      FORBIDDEN_CALLS.filter((call) => code.includes(call)).map(
        (call) => `${file}: ${call}`,
      ),
    );
    expect(violations).toEqual([]);
  });

  it("keeps one play record of its own and no other", () => {
    const writes = guideSources().flatMap(({ file, code }) =>
      [...code.matchAll(/\.setItem\(\s*([^,]+),/g)].map(
        (match) => `${file}: ${match[1]?.trim()}`,
      ),
    );
    expect(writes).toEqual(["guide-memory.ts: STORAGE_PREFIX + owner"]);
    const memory = guideSources().find(
      ({ file }) => file === "guide-memory.ts",
    );
    expect(memory?.code).toContain('"nilx-one.guide.v1."');
  });

  it("answers the end of a scene with navigation and its own record only", () => {
    const home = withoutComments(readFileSync(HOME, "utf8"));
    const ending = functionBody(home, "endGuideScene");
    const calls = [...ending.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
      .map((match) => match[1])
      .filter((name) => name !== "if");
    expect(new Set(calls)).toEqual(
      new Set([
        "postponeGuideIntro",
        "rememberGuideIntro",
        "openDetail",
        "handWheel",
      ]),
    );
    // Handing the wheel over from a reply fetches nothing: only the Dock's own
    // gesture asks a device for the runtime.
    expect(functionBody(home, "handWheel")).not.toContain("onPrepareAvaia");
  });
});
