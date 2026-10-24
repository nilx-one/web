// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer } from "@nilx-one/map-contract";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "../../shell/app-shell";
import { useLocalization } from "../../shell/localization";
import { useShellPresentation } from "../../shell/shell-presentation";
import { BusinessDock, type BusinessDockProps } from "./business-dock";

function BusinessMap({ renderer }: { renderer: MapRenderer }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState(() => renderer.getStatus());
  const { resolved } = useLocalization();
  useEffect(() => renderer.subscribe(setStatus), [renderer]);
  useEffect(() => {
    if (container.current === null) return;
    renderer.mount(container.current);
    return () => renderer.unmount();
  }, [renderer]);
  const unavailable =
    resolved === "uk-UA"
      ? "Мапа тимчасово недоступна"
      : resolved === "ru-RU"
        ? "Карта временно недоступна"
        : "Map temporarily unavailable";
  return (
    <div className="business-world-map">
      <div className="business-world-map__canvas" ref={container} />
      {status.kind === "unavailable" ? (
        <p className="business-world-map__status" role="status">
          {unavailable}
        </p>
      ) : null}
    </div>
  );
}

/** Public browsing does not construct a visitor Bond, an Avaia or an authenticated world. */
export function BusinessWorld({
  renderer,
  content,
  ...dock
}: BusinessDockProps & {
  readonly renderer: MapRenderer;
  readonly content?: ReactNode;
}) {
  const presentation = useShellPresentation();
  return (
    <AppShell
      presentation={presentation}
      safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      world={<BusinessMap renderer={renderer} />}
      header={null}
      dock={content ?? <BusinessDock {...dock} />}
    />
  );
}
