# Error Trash

A shared sink for errors. `nilx-one`, `aiaiaiai-tech`, `0xda-market`, and any
other project holding an ingest token dump their failures into one table
instead of into per-project logs nobody reads.

The trash stores what a reporter says. It does not deduplicate, group,
symbolicate, alert, or decide what an error means; anything that classifies
failures belongs above this boundary, not inside it.

## Table

One table, `errors`, holds every project's dumps:

| Column        | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| `id`          | Insertion order, and the only identity a dump has.                |
| `project`     | Which project reported, resolved from the ingest token.           |
| `type`        | The reporter's own label: `panic`, `http_500`, `TypeError`, …     |
| `full_text`   | The whole error text: message, stack trace, context, as reported. |
| `observed_at` | When the reporter noticed the error (client-stated).              |
| `received_at` | When the trash accepted it (server clock).                        |

Both instants are stored as `YYYY-MM-DDTHH:MM:SSZ`, so lexicographic order is
chronological order and a range filter is a string comparison.

`observed_at` and `received_at` are separate on purpose. A reporter that
batches, retries, or runs with a wrong clock still lands one honest column: the
trash never rewrites a reported instant, and never lets a reported instant
decide retention.

## API

- `POST /api/v1/errors` — dump one error object or an array of up to 50;
- `GET /api/v1/errors` — read the newest dumps back;
- `GET /health` — process health, without a token.

Dump a single error:

```bash
curl --request POST https://<error-trash-host>/api/v1/errors \
  --header "authorization: Bearer $ERROR_TRASH_TOKEN" \
  --header 'content-type: application/json' \
  --data '{
    "type": "unhandled_rejection",
    "full_text": "TypeError: x is not a function\n  at boot (main.js:1:1)",
    "observed_at": "2026-09-05T02:00:00Z"
  }'
```

`type` and `full_text` are required. `observed_at` is optional and defaults to
the trash clock. `project` is optional for a project-bound token and required
for a shared one. The response is `201` with `{"stored":1,"ids":[1]}`.

An array in the same endpoint stores a batch atomically, so a reporter retries
the whole request or none of it:

```json
[
  {
    "project": "aiaiaiai-tech/core",
    "type": "panic",
    "full_text": "thread 'main' panicked at …"
  },
  {
    "project": "0xda-market/api",
    "type": "http_500",
    "full_text": "upstream timeout"
  }
]
```

Reads take `project`, `type`, `since`, `until`, and `limit` (default 50,
maximum 500), newest first:

```bash
curl "https://<error-trash-host>/api/v1/errors?project=nilx-one/web&type=panic&since=2026-09-01T00:00:00Z" \
  --header "authorization: Bearer $ERROR_TRASH_READ_TOKEN"
```

Rejections carry a stable code: `invalid_token`, `foreign_project`,
`project_required`, `invalid_request_body`, `invalid_project`, `invalid_type`,
`empty_full_text`, `invalid_observed_at`, `empty_batch`, `batch_too_large`,
`invalid_query`, `rate_limited`, `read_disabled`, `error_trash_unavailable`.

## Token boundary

A token decides which project a dump is written under, so no project can dump
errors in another project's name:

- `project:token` binds a token to exactly one project;
- `*:token` is a shared organization token whose reports must name their own
  project.

Ingest is closed without a configured token, and reading is closed until
`ERROR_TRASH_READ_TOKEN` is set — dumped text routinely contains internal
detail that no anonymous caller should see. Tokens are at least 32 characters,
are held only as SHA-256 digests, and are compared in constant time.

An ingest token is not a browser secret. A browser client reports through a
server-side proxy that holds the token; shipping an ingest token in JavaScript
would publish it to everyone who loads the page.

## Limits and retention

- 512 KiB per request, 50 errors per batch;
- `full_text` is truncated at 32 768 characters with a visible marker rather
  than rejected, because a truncated dump is worth more than a lost one;
- 600 requests per minute per source and 3 000 per minute per project;
- retention runs hourly and drops dumps older than
  `ERROR_TRASH_RETENTION_DAYS` (default 90) or beyond `ERROR_TRASH_MAX_ROWS`
  (default 1 000 000). Age is measured on `received_at`, so a reporter cannot
  extend its own retention with a wrong clock. `0` disables either bound.

## Run

```bash
ERROR_TRASH_INGEST_TOKENS='nilx-one/web:local-ingest-token-that-is-long-enough' \
ERROR_TRASH_READ_TOKEN='local-read-token-that-is-long-enough-here' \
  cargo run --manifest-path services/errors/Cargo.toml
```

Runtime settings:

- `ERROR_TRASH_INGEST_TOKENS` — required, comma-separated `project:token`;
- `ERROR_TRASH_READ_TOKEN` — optional; reads stay disabled while it is unset;
- `DATABASE_URL` — default `sqlite://error-trash.db`;
- `HTTP_BIND` — default `0.0.0.0:8080`;
- `ERROR_TRASH_RETENTION_DAYS` — default `90`, `0` keeps everything;
- `ERROR_TRASH_MAX_ROWS` — default `1000000`, `0` keeps everything.

## Runtime package

[`Dockerfile`](Dockerfile) builds the service. [`deploy/compose.yaml`](deploy/compose.yaml)
persists SQLite state in a named volume and exposes only the private
`ox1-error-trash:8080` edge alias, so CI validates the same runtime an operator
activates.

The public route is a separate activation decision and is not published yet:
the trash is reachable inside the edge network only. Publishing it for projects
outside this host means adding one proxy route to that alias — under a
dedicated origin, or as `/api/v1/errors` on an existing one — after the image is
deployed.

## Verify

```bash
cargo generate-lockfile --manifest-path services/errors/Cargo.toml
cargo fmt --manifest-path services/errors/Cargo.toml --all -- --check
cargo clippy --manifest-path services/errors/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path services/errors/Cargo.toml --locked --all-features
```

---

© 2026 aiaiaiai · aiaiaiai.org
