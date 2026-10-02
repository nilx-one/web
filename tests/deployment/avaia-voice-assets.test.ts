// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { AVATAR_MODEL_IDS } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { avaiaLines } from "../../packages/product-app/src/features/map/avaia-lines";
import {
  AVAIA_VOICE_VERSION,
  VOICED_KINDS,
  VOICED_LOCALES,
  avaiaVoicePath,
} from "../../packages/product-app/src/features/map/avaia-voice";

interface VoiceManifest {
  readonly version: string;
  readonly voices: Record<string, Record<string, { readonly model: string }>>;
  readonly models: Record<string, { readonly license: string }>;
  readonly lines: Record<
    string,
    {
      readonly text: string;
      readonly sha256: string;
      readonly characterErrorRate: number;
    }
  >;
}

const ROOT = resolve(__dirname, "../..");
const VOICES = join(ROOT, "deploy/web/voices", AVAIA_VOICE_VERSION);
const manifest = JSON.parse(
  readFileSync(join(VOICES, "manifest.json"), "utf8"),
) as VoiceManifest;

function clips(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return clips(path);
    return entry.endsWith(".mp3") ? [relative(VOICES, path)] : [];
  });
}

describe("recorded Avaia lines", () => {
  it("are the version the client asks for", () => {
    expect(manifest.version).toBe(AVAIA_VOICE_VERSION);
  });

  it("give every study a voice in every voiced locale", () => {
    for (const locale of VOICED_LOCALES) {
      expect(Object.keys(manifest.voices[locale] ?? {}).sort()).toEqual(
        [...AVATAR_MODEL_IDS].sort(),
      );
    }
  });

  it("record exactly the fixed lines the catalog holds today", () => {
    // A line edited in avaia-lines.ts without a re-render fails here, so a
    // voice never says words the card no longer shows.
    const expected: Record<string, string> = {};
    for (const locale of VOICED_LOCALES) {
      for (const model of AVATAR_MODEL_IDS) {
        for (const kind of VOICED_KINDS) {
          avaiaLines(locale, model, kind).forEach((text, index) => {
            expected[`${locale}/${model}/${kind}.${index}`] = text;
          });
        }
      }
    }
    const recorded = Object.fromEntries(
      Object.entries(manifest.lines).map(([key, line]) => [key, line.text]),
    );
    expect(recorded).toEqual(expected);
  });

  it("serve one file per recorded line, as the manifest describes it", () => {
    const files = clips(VOICES).sort();
    expect(files).toEqual(
      Object.keys(manifest.lines)
        .map((key) => `${key}.mp3`)
        .sort(),
    );
    for (const [key, line] of Object.entries(manifest.lines)) {
      const bytes = readFileSync(join(VOICES, `${key}.mp3`));
      expect(createHash("sha256").update(bytes).digest("hex"), key).toBe(
        line.sha256,
      );
    }
  });

  it("sit where the client looks for them", () => {
    const [locale, model, rest] = Object.keys(manifest.lines)[0]!.split("/");
    const [kind, index] = rest!.split(/\.(?=\d+$)/);
    expect(
      avaiaVoicePath(
        locale as never,
        model as never,
        kind as never,
        Number(index),
      ),
    ).toBe(`/voices/${AVAIA_VOICE_VERSION}/${locale}/${model}/${rest}.mp3`);
  });

  it("were each understood by the judge that picked them", () => {
    const misheard = Object.entries(manifest.lines)
      .filter(([, line]) => line.characterErrorRate > 0.25)
      .map(([key, line]) => `${key} ${line.characterErrorRate}`);
    expect(misheard).toEqual([]);
  });

  it("credit a license for every model that made them", () => {
    for (const [name, model] of Object.entries(manifest.models)) {
      expect(model.license, name).not.toBe("");
    }
  });

  it("are served from the runtime image with immutable caching", () => {
    const caddy = readFileSync(join(ROOT, "deploy/web/Caddyfile"), "utf8");
    expect(caddy).toMatch(
      /@voice_assets path \/voices\/\*\s+handle @voice_assets \{\s+root \* \/srv\s+header Cache-Control "public, max-age=31536000, immutable"/,
    );
    const dockerfile = readFileSync(
      join(ROOT, "deploy/web/Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toContain("COPY deploy/web/voices/ /srv/voices/");
    expect(existsSync(VOICES)).toBe(true);
  });
});
