// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer, MapRendererStatus } from "@nilx-one/map-contract";
import { useEffect, useRef, useState } from "react";

import "./map-foundation-view.css";
import { createMapFoundationViewModel } from "./map-foundation-view-model";

export interface MapFoundationViewProps {
  readonly renderer: MapRenderer;
}

export function MapFoundationView({ renderer }: MapFoundationViewProps) {
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
        <strong>{viewModel.label}</strong>
        <span>{viewModel.detail}</span>
      </aside>
    </main>
  );
}
