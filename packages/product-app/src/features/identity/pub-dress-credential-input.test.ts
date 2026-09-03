// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { normalizePubDressCredentialInput } from "./pub-dress-credential-input";

describe("pub_dress credential input", () => {
  it("splits a canonical username autofilled into the slug field", () => {
    expect(
      normalizePubDressCredentialInput(
        { discriminator: "0", slug: "0x0sky" },
        { discriminator: "0", slug: "" },
      ),
    ).toEqual({ discriminator: "0", slug: "sky" });
  });

  it("parses a canonical username before discriminator-change shortcuts", () => {
    expect(
      normalizePubDressCredentialInput(
        { discriminator: "f", slug: "0x0frSb2" },
        { discriminator: "0", slug: "frSb2" },
      ),
    ).toEqual({ discriminator: "0", slug: "frSb2" });
  });

  it("keeps the selected discriminator for slug-only credentials", () => {
    expect(
      normalizePubDressCredentialInput(
        { discriminator: "f", slug: "sky" },
        { discriminator: "f", slug: "" },
      ),
    ).toEqual({ discriminator: "f", slug: "sky" });
  });

  it("splits a compact numeric discriminator plus slug autofill", () => {
    expect(
      normalizePubDressCredentialInput(
        { discriminator: "f", slug: "0sky" },
        { discriminator: "f", slug: "" },
      ),
    ).toEqual({ discriminator: "0", slug: "sky" });
  });

  it("splits a compact hexadecimal discriminator plus slug autofill", () => {
    expect(
      normalizePubDressCredentialInput(
        { discriminator: "0", slug: "fsky" },
        { discriminator: "0", slug: "" },
      ),
    ).toEqual({ discriminator: "f", slug: "sky" });
  });

  it("does not steal a manually typed numeric-leading slug", () => {
    expect(
      normalizePubDressCredentialInput(
        { discriminator: "f", slug: "012" },
        { discriminator: "f", slug: "01" },
      ),
    ).toEqual({ discriminator: "f", slug: "012" });
  });

  it("does not reinterpret an explicit discriminator selector change", () => {
    expect(
      normalizePubDressCredentialInput(
        { discriminator: "a", slug: "0sky" },
        { discriminator: "0", slug: "0sky" },
      ),
    ).toEqual({ discriminator: "a", slug: "0sky" });
  });
});
