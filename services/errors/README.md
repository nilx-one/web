# Error Trash

A shared, product-agnostic sink for errors. Production storage is PostgreSQL/Supabase owned by the parent `aiaiaiai` organization. `nilx-one`, `0xda-market`, and future child projects are reporters; they do not own the database or its schema.

The sink stores what a reporter says. It does not deduplicate, group, symbolicate, alert, or decide what an error means. Anything that classifies failures belongs above this boundary.

## Storage

Production requires `DATABASE_URL` and fails fast when it is missing. The intended production backend is the parent-owned Supabase project `aiaiaiai-errors`. SQLite remains supported by the repository abstraction for local/test use only.

One table, `errors`, stores all reports:

| Column | Meaning |
| --- | --- |
| `id` | Insertion order and the only identity a report has. |
| `project` | Reporter identity resolved from the ingest token. |
| `type` | Reporter-provided label such as `panic`, `http_500`, or `TypeError`. |
| `full_text` | Full error text, stack trace, and context as reported. |
| `observed_at` | Client-stated observation time. |
| `received_at` | Server-side receive time. |

Indexes support observation-time, project/time, type/time, and retention queries.

The Supabase table has RLS enabled and explicitly revokes table access from `anon` and `authenticated`. No browser-facing RLS policy is intended. The service writes through direct PostgreSQL credentials only; privileged credentials and ingest/read tokens must remain server-side.

## API

- `POST /api/v1/errors` — store one error or an atomic batch of up to 50;
- `GET /api/v1/errors` — read newest reports with optional `project`, `type`, `since`, `until`, and `limit` filters;
- `GET /health` — process health without a token.

A project-bound ingest token determines the stored `project`. A shared `*` token requires the request to name its own project. Cross-project writes are rejected.

Example:

```bash
curl --request POST https://<error-sink-host>/api/v1/errors \
  --header "authorization: Bearer $ERROR_TRASH_TOKEN" \
  --header 'content-type: application/json' \
  --data '{
    "type": "unhandled_rejection",
    "full_text": "TypeError: x is not a function\n  at boot (main.js:1:1)",
    "observed_at": "2026-09-05T02:00:00Z"
  }'
```

The response is `201` with `{"stored":1,"ids":[1]}` when accepted.

Reads remain disabled until `ERROR_TRASH_READ_TOKEN` is configured. An ingest token is never a browser secret: browser clients must report through a server-side boundary that holds it.

## Limits and retention

- 512 KiB per request;
- 50 reports per batch;
- `full_text` is truncated at 32 768 characters with a visible marker;
- 600 requests per minute per source and 3 000 per minute per project;
- retention runs hourly and defaults to 90 days / 1 000 000 rows;
- retention age is measured from `received_at`, not the reporter-controlled clock.

## Runtime

Required server-side variables:

- `DATABASE_URL` — PostgreSQL/Supabase in production;
- `ERROR_TRASH_INGEST_TOKENS` — comma-separated `project:token` entries.

Optional variables:

- `ERROR_TRASH_READ_TOKEN` — enables reads when present;
- `HTTP_BIND` — defaults to `0.0.0.0:8080`;
- `ERROR_TRASH_RETENTION_DAYS` — defaults to `90`, `0` disables the age bound;
- `ERROR_TRASH_MAX_ROWS` — defaults to `1000000`, `0` disables the row-count bound.

[`Dockerfile`](Dockerfile) builds the service. [`deploy/compose.yaml`](deploy/compose.yaml) requires the production database URL through `ERROR_TRASH_DATABASE_URL`, exposes only the internal `aiaiaiai-errors:8080` edge alias, and does not persist a local SQLite volume.

A public route is a separate deployment decision. No privileged token or database credential belongs in frontend code.

## Verify

```bash
cargo generate-lockfile --manifest-path services/errors/Cargo.toml
cargo fmt --manifest-path services/errors/Cargo.toml --all -- --check
cargo clippy --manifest-path services/errors/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path services/errors/Cargo.toml --locked --all-features
```

---

© 2026 aiaiaiai · aiaiaiai.org
