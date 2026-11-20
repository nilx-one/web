<!-- © 2026 aiaiaiai · aiaiaiai.org -->

# Stage 0x1 clients from nilx-one/web

Open **Actions → Request 0x1 client staging** in `nilx-one/web`.
Choose the branch and one target:

- `--all` — all three clients
- `--web` — Web only
- `--telegram` — Telegram Mini App only
- `--discord` — Discord Activity only

The selected branch runs Web Full CI and Package Clients.
Both must pass for its exact commit SHA.
The workflow then verifies the GHCR image provenance.

The selected branch has no Infra or SSH secrets.
It uploads a request containing only branch, SHA, target, and run ID.

A separate trusted workflow on `master` validates that request.
Only this relay uses the existing `INFRA_DEPLOY_TOKEN` to contact Infra.
No additional personal access token is required.

Infra independently verifies the Web run and image provenance.
It stages the selected clients privately on the new VPS.
Public DNS, Identity SQLite, and Render services remain unchanged.

The relay confirms only that Infra accepted the request.
Check the corresponding Infra Actions run for the staging result.
