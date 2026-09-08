// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const HOST_DOCUMENTS = [
  "apps/site/index.html",
  "apps/telegram-mini-app/index.html",
  "apps/discord-activity/index.html",
];

const uiStyles = read("packages/ui/src/styles.css");
const shellAppearance = read("packages/product-app/src/shell/appearance.ts");
const productApp = read("packages/product-app/src/index.tsx");
const mapHome = read(
  "packages/product-app/src/features/map/authenticated-map-home-view.tsx",
);

describe("one appearance across the whole interface", () => {
  it("resolves the appearance in every host before the first paint", () => {
    for (const document of HOST_DOCUMENTS) {
      const html = read(document);
      // A classic inline script in the head, not a module: it has to run
      // during parse, before anything is painted in the wrong colour.
      expect(html).toMatch(/<script>[\s\S]*data-appearance[\s\S]*<\/script>/);
      expect(html).toContain("nilx-one.interface.appearance");
      expect(html).toContain(
        'window.matchMedia("(prefers-color-scheme: dark)")',
      );
    }
  });

  // The sign-in surface and the world read one stamped attribute, so passing
  // the login cannot change the colour by itself.
  it("stamps the resolved appearance once, on the document", () => {
    expect(shellAppearance).toContain(
      'export const APPEARANCE_ATTRIBUTE = "data-appearance"',
    );
    expect(productApp).toContain("applyAppearance(appearance.resolved)");
    expect(mapHome).toContain("const appearance = useAppearance()");
    // No surface may resolve the appearance a second time for itself.
    expect(mapHome).not.toContain("prefers-color-scheme");
  });

  it("never paints dark without a choice or a device that asks for it", () => {
    // A default-dark media query would black out a document whose stored
    // choice has not been read yet, which is the flash this contract exists
    // to prevent.
    expect(uiStyles).not.toContain("prefers-color-scheme");
    expect(uiStyles).toContain(':root[data-appearance="dark"]');
    for (const document of HOST_DOCUMENTS) {
      expect(read(document)).toContain(
        '<meta name="theme-color" content="#f3f8fc" />',
      );
    }
  });
});
