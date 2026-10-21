// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeCityHandoff,
  createBusinessNavigation,
} from "./business-navigation";

afterEach(() => window.history.replaceState(null, "", "/"));
describe("business browser navigation", () => {
  it("consumes a bounded city hint without leaving it in shareable URLs", () => {
    window.history.replaceState(null, "", "/#business-city=ua%3Akyiv");
    expect(consumeCityHandoff()).toBe("ua:kyiv");
    expect(window.location.hash).toBe("");
  });
  it("resolves direct point paths and deterministically returns to organization", () => {
    window.history.replaceState(null, "", "/zoloti_vorota");
    const navigation = createBusinessNavigation("0xda-market");
    const listener = vi.fn();
    const unsubscribe = navigation.subscribe(listener);
    expect(navigation.getSnapshot()?.point).toBe("zoloti_vorota");
    navigation.open("0xda-market", undefined, "ua:kyiv");
    expect(window.location.pathname).toBe("/");
    expect(navigation.getSnapshot()).toEqual({
      label: "0xda-market",
      cityId: "ua:kyiv",
    });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
  it("keeps internal navigation in the main origin and synchronizes popstate", () => {
    window.history.replaceState(null, "", "/?business=0xda-market");
    const navigation = createBusinessNavigation();
    const unsubscribe = navigation.subscribe(() => undefined);
    navigation.open("0xda-market", "zoloti_vorota", "ua:kyiv");
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).not.toContain("kyiv");
    window.history.replaceState(
      { businessCity: "fr:paris" },
      "",
      "/?business=0xda-market",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(navigation.getSnapshot()).toEqual({
      label: "0xda-market",
      cityId: "fr:paris",
    });
    window.history.replaceState(null, "", "/settings");
    navigation.sync();
    expect(navigation.getSnapshot()).toBeNull();
    navigation.close();
    expect(navigation.getSnapshot()).toBeNull();
    unsubscribe();
  });
  it("does not turn malformed point paths into a root or allow URL injection", () => {
    window.history.replaceState(null, "", "/point/extra");
    const navigation = createBusinessNavigation("0xda-market");
    expect(navigation.getSnapshot()?.point).toBe("!invalid");
    expect(() => navigation.open("evil.test", "test")).toThrow();
    expect(() => navigation.open("0xda-market", "//evil.test")).toThrow();
  });
});
