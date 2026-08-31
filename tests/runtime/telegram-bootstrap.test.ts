// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appDirectory = resolve("apps/telegram-mini-app");
const document = readFileSync(resolve(appDirectory, "index.html"), "utf8");

describe("Telegram Mini App bootstrap", () => {
  it("loads after the Telegram SDK and before the React application", () => {
    const sdk = document.indexOf("telegram-web-app.js");
    const ready = document.indexOf("window.Telegram?.WebApp?.ready()");
    const expand = document.indexOf("window.Telegram?.WebApp?.expand()");
    const application = document.indexOf("/src/main.tsx");

    expect(sdk).toBeGreaterThanOrEqual(0);
    expect(ready).toBeGreaterThan(sdk);
    expect(expand).toBeGreaterThan(ready);
    expect(application).toBeGreaterThan(expand);
  });
});
