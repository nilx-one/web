// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer, MapRendererStatus } from "@nilx-one/map-contract";
import { useEffect, useRef, useState } from "react";

import "./map-foundation-view.css";
import { createMapFoundationViewModel } from "./map-foundation-view-model";
import { translateCopy, useLocalization } from "../../shell/localization";

export interface MapFoundationViewProps {
  readonly renderer: MapRenderer;
}

export function MapFoundationView({ renderer }: MapFoundationViewProps) {
  const { t } = useLocalization();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapRendererStatus>(() =>
    renderer.getStatus(),
  );

  useEffect(() => renderer.subscribe(setStatus), [renderer]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    renderer.mount(container);
    return () => renderer.unmount();
  }, [renderer]);

  const viewModel = createMapFoundationViewModel(status);

  return (
    <main className="map-foundation" data-map-tone={viewModel.tone}>
      <div className="map-foundation__canvas" ref={containerRef} />
      <aside className="map-foundation__status" aria-live="polite">
        <strong>{translateCopy(t, viewModel.label)}</strong>
        <span>{translateCopy(t, viewModel.detail)}</span>
      </aside>
    </main>
  );
}
