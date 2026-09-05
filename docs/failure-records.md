# Failure records

A failure has to go two ways at once: to the person waiting on the operation,
and into a durable record someone reads later. This repository already had the
first — `createFailureNotice` turns a classified report into person-facing copy,
and the map surface names a renderer failure in place. This is the second.

## What is shared and what is not

The classification is not ours to invent. `FailureKind` — `unavailable`,
`withheld`, `gated`, `rejected`, `exhausted` — is owned by the shared
foundation, and this client copies `kind` and `retryable` from the report it is
given rather than re-deriving them from `code`. Two surfaces that classified the
same code differently would make the table unreadable.

What this repository owns is the **row** and the **store**:

```text
        FailureReport { code, kind, retryable }
                        |
        createFailureRecord ────── FailureRecord
                        |               |
             surface, component     the row a surface writes
             release, timestamp         |
                                 FailureSinkPort
                                        |
                        createSupabaseFailureSink → failure_records
```

`FailureRecord` lives in `@nilx-one/application` and performs no I/O.
`@nilx-one/failure-supabase` is the only package that talks to a store, so
swapping the store never reaches the surfaces that record.

## What a record never carries

No subject identifier. `session_id` and `operation_id` correlate a record with
the work that produced it, which is what an operator needs. A durable table
keyed by the person a runtime acts for is a different artifact with a different
retention contract, and a failure table is not a way around that.

Absent columns are omitted rather than written null, so a reader can tell "this
surface had nothing to say" from "this surface said nothing".

## Recording is best effort

`FailureSinkPort.record` returns nothing and never throws. The caller is already
handling something that went wrong; a sink that could fail loudly would turn one
failure into two. A delivery that is refused or rejected reaches `onDropped`,
never the surface.

Writes use `keepalive`, so a record survives a page the failure is about to take
down.

## Configuring the store

Run `deploy/supabase/0001_failure_records.sql` against the project, then build
the client with:

```text
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_RELEASE_SHA=<release commit>
```

All three are optional. A build without them keeps every surface working and
simply keeps no durable record — the sink is absent, not broken.

The anon key ships inside a browser bundle. That is safe only because row level
security in the migration grants `anon` **insert and nothing else**: a client
that could read the table could read every other client's failures. The service
role key must never reach a browser.

## What writes records today

| Surface      | Component      | Codes                                                              |
| ------------ | -------------- | ------------------------------------------------------------------ |
| `web-client` | `map-renderer` | `style-load-failed`, `basemap-load-failed`, `renderer-init-failed` |

Renderer failures are recorded from the composition root rather than from a
view, so a view that unmounts mid-failure does not take the record with it.

## Not delivered yet

Host-side service failures (`surface: web-host`) — a container that did not come
up, a healthcheck that never passed, an activation that rolled back. The row
shape and the table already accept them; what is missing is the shell-side
writer in `deploy/web/`. It belongs next to `deploy.sh`, which is where those
outcomes are already known.

---

© 2026 aiaiaiai · aiaiaiai.org
