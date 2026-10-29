// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMapRendererDouble,
  UNSUPPORTED_GEOLOCATION_DOUBLE,
} from "../../../../../tests/support/doubles";
import {
  AuthenticatedMapHomeView,
  canonicalBondPublicUrl,
  type MapBondReference,
} from "./authenticated-map-home-view";

afterEach(cleanup);

function renderWorld({
  pubDressUrl = "https://0x0sky.nilx.one/",
  bondBodies,
  section,
  onNavigate,
}: {
  pubDressUrl?: string | undefined;
  bondBodies?: readonly MapBondReference[];
  section?: "world" | "identity";
  onNavigate?: (route: string) => void;
} = {}) {
  const renderer = createMapRendererDouble();
  const rendered = render(
    <AuthenticatedMapHomeView
      hostLabel="browser host"
      pubDress="0x0sky"
      pubDressUrl={pubDressUrl}
      {...(bondBodies === undefined ? {} : { bondBodies })}
      {...(section === undefined ? {} : { section })}
      {...(onNavigate === undefined ? {} : { onNavigate })}
      renderer={renderer}
      geolocation={UNSUPPORTED_GEOLOCATION_DOUBLE}
      runtime={{
        tone: "ready",
        label: "Shared Core ready",
        detail: "Contract available.",
      }}
      safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
    />,
  );
  return { renderer, ...rendered };
}

describe("Bond model activation", () => {
  it("opens its own main screen without handing over the wheel", () => {
    const onNavigate = vi.fn();
    const { renderer, container } = renderWorld({ onNavigate });
    act(() => renderer.activateBody("bond"));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/identity");
    // No second screen about the same Bond is stacked on the world.
    expect(container.querySelector(".bond-dock")).toHaveAttribute(
      "data-screen",
      "home",
    );
  });

  it("links its own main screen to its public address", () => {
    const { container } = renderWorld({ section: "identity" });

    expect(container.querySelector(".bond-dock")).toHaveAttribute(
      "data-screen",
      "identity",
    );
    expect(screen.getByRole("heading", { name: "0x0sky" })).toBeVisible();
    const publicUrl = screen.getByRole("link", {
      name: /0x0sky\.nilx\.one/,
    });
    expect(publicUrl).toHaveAttribute("href", "https://0x0sky.nilx.one/");
    expect(publicUrl).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("selects a distinct Bond from an application-owned drawn body handle", () => {
    const unicodeUrl = "https://0x0тест.nilx.one/";
    const { renderer, container } = renderWorld({
      bondBodies: [
        {
          bodyId: "external-bond:17",
          pubDress: "0x0тест",
          pubDressUrl: unicodeUrl,
        },
      ],
    });
    act(() => renderer.activateBody("external-bond:17"));
    expect(container.querySelector(".bond-dock")).toHaveAttribute(
      "data-screen",
      "bond:external-bond:17",
    );
    expect(screen.getByRole("heading", { name: "0x0тест" })).toBeVisible();
    expect(screen.getByRole("link", { name: /nilx\.one/ })).toHaveAttribute(
      "href",
      new URL(unicodeUrl).href,
    );
  });

  it("does not invent identity from an unknown rendered object", () => {
    const { renderer, container } = renderWorld({
      bondBodies: [{ bodyId: "other", pubDress: "0x0other" }],
    });
    act(() => renderer.activateBody("some-unknown-body"));
    expect(container.querySelector(".bond-dock")).toHaveAttribute(
      "data-screen",
      "home",
    );

    act(() => renderer.activateBody("other"));
    expect(screen.getByRole("heading", { name: "0x0other" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /nilx\.one/ })).toBeNull();
  });

  it("keeps Avaia activation as camera focus, not another Bond identity", () => {
    const { renderer, container } = renderWorld();
    act(() => renderer.activateBody("avaia"));
    expect(container.querySelector(".bond-dock")).toHaveAttribute(
      "data-screen",
      "home",
    );
    expect(screen.queryByRole("link", { name: /nilx\.one/ })).toBeNull();
  });
});

describe("allocated Bond public links", () => {
  it("normalizes a Core-allocated internationalized label with IDNA", () => {
    expect(canonicalBondPublicUrl("https://0x0тест.nilx.one")).toBe(
      new URL("https://0x0тест.nilx.one/").href,
    );
  });

  it("rejects URLs outside the public Bond zone or carrying extraneous data", () => {
    for (const url of [
      "javascript:alert(1)",
      "http://0x0sky.nilx.one/",
      "https://0x0sky.nilx.one.evil.test/",
      "https://nilx.one/",
      "https://a.b.nilx.one/",
      "https://0x0sky.nilx.one/secret",
      "https://0x0sky.nilx.one/?token=1",
      "https://user:password@0x0sky.nilx.one/",
      "https://0x0sky.nilx.one/#fragment",
    ]) {
      expect(canonicalBondPublicUrl(url)).toBeUndefined();
    }
    expect(canonicalBondPublicUrl(undefined)).toBeUndefined();
  });
});
