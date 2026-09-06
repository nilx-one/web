# Browser error reporting

`nilx-one/web` uses `@aiaiaiai/4x-errors-browser` as its browser observability boundary. The client does not own an error database, Supabase schema, retry loop, durable queue, or browser ingest credentials.

The site composition root creates one reporter with `project: "nilx-one/web"` and `source: "browser"`. `VITE_ERRORS_COLLECTOR_ENDPOINT` is public configuration and points at the 4x-errors collector. When it is absent, the SDK intentionally becomes a no-op reporter and the product remains usable.

The SDK owns privacy sanitisation, the durable IndexedDB queue, bounded batching and retry, circuit breaking, deduplication, reconnect/backlog recovery, lifecycle delivery, and global `error` / `unhandledrejection` capture. The browser never receives PostgreSQL, Supabase, service-role, or trusted ingest credentials.

Map renderer failures are additionally translated at the composition root into semantic `errors.v1` identifiers:

- `style-load-failed` → `map.renderer.style.load.failed`
- `basemap-load-failed` → `map.renderer.basemap.load.failed`
- `renderer-init-failed` → `map.renderer.init.failed`
- `style-load-timeout` → `map.renderer.style.load.timeout`
- `first-paint-timeout` → `map.renderer.first_paint.timeout`
- `container-zero-size` → `map.renderer.container.zero_size`
- `webgl-unavailable` → `map.renderer.webgl.unavailable`
- `webgl-context-lost` → `map.renderer.webgl.context_lost`

A renderer startup failure must arrive as its own identifier: a style document
that never answered, a style that resolved but never painted, a client without a
WebGL2 context, and a surface with no size are different production problems,
and collapsing them into one generic map failure makes the next one unreadable.
A reason this table has not learned is still reported, under
`map.renderer.unavailable`.

The UI remains responsible for person-facing failure notices. Error reporting is observability only and must never redefine 0x1 domain state or make a host failure worse.

---

© 2026 aiaiaiai · aiaiaiai.org
