<!-- © 2026 aiaiaiai · aiaiaiai.org -->

# Stage 0x1 clients from nilx-one/web

In GitHub Actions, choose **Request 0x1 client staging**, the desired
branch in GitHub's native *Run workflow* selector, and one target:
`--all`, `--web`, `--telegram`, or `--discord`.

The request workflow starts **Web** Full CI and **Package Clients** on
the selected branch, waits for successful exact-commit runs, and verifies
the signed immutable GHCR image. It creates only a minimal artifact with
source SHA, source branch, target and GitHub run ID.

A separate `workflow_run` relay runs from protected `master`, validates
that artifact against the successful originating workflow, and uses the
existing production Environment's `INFRA_DEPLOY_TOKEN` to request staging
in aiaiaiai-org/infra. No SSH or Infra token is passed to selected-branch
jobs. Do not add additional PATs.

Infra then independently verifies the origin run and OCI provenance and
stages selected private client containers on the new VPS. This is not yet
public `nilx.one` deployment; DNS, Identity SQLite and Market/Render are
not changed. Requires matching Infra PR support for
`repository_dispatch` event `stage-nilx-clients`.

The source workflow does not itself deploy, and the relay's successful
dispatch only means Infra accepted the request, not that its deployment
succeeded. Inspect Infra's corresponding Actions run for final result.
