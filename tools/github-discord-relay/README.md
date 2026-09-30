<!-- © 2026 aiaiaiai · aiaiaiai.org -->

# GitHub → Discord task relay

A Cloudflare Worker that receives the `nilx-one` **organization** webhook and
posts task updates to a Discord channel:

| GitHub event                                    | Discord message                         |
| ----------------------------------------------- | --------------------------------------- |
| `issues.opened`                                 | New task, assigned to @login            |
| `issues.assigned` / `unassigned`                | Assigned to @login / Unassigned @login  |
| `issues.closed` / `reopened`                    | Closed as completed / not planned, etc. |
| `projects_v2_item.edited` on the `Status` field | Status: Todo → In Progress              |

Project status events only exist on organization webhooks, not on repository
webhooks, and GitHub Actions cannot trigger on them. That is why this runs as a
small relay instead of a workflow.

Issues from private repositories are skipped, so a public server never sees
them. Draft issues on a project board are posted.

Messages never ping anyone: `allowed_mentions` is empty, so `@everyone` in an
issue title stays text.

## Setup

1. **Discord.** In the channel (for example `#tasks`): _Edit Channel →
   Integrations → Webhooks → New Webhook → Copy Webhook URL_.
2. **Webhook secret.** Generate one, for example `openssl rand -hex 32`.
3. **GitHub token (optional but recommended).** A fine-grained token owned by
   `nilx-one` with read-only _Issues_, _Pull requests_ and organization
   _Projects_ access. Without it, status messages can't show the task title
   or link.
4. **Repository secrets** in `nilx-one/web` → _Settings → Secrets and
   variables → Actions_:
   - `CLOUDFLARE_API_TOKEN`: token with the _Edit Cloudflare Workers_
     template
   - `CLOUDFLARE_ACCOUNT_ID`
   - `TASKS_DISCORD_WEBHOOK_URL`: from step 1
   - `TASKS_WEBHOOK_SECRET`: from step 2
   - `TASKS_GITHUB_TOKEN`: from step 3
5. **Deploy.** Run the _Deploy GitHub Discord Relay_ workflow. Its log prints
   the Worker URL, `https://nilxone-github-discord-relay.<account>.workers.dev`.
   Later pushes to `master` that touch this directory redeploy automatically.
6. **Organization webhook.** `github.com/organizations/nilx-one/settings/hooks`
   → _Add webhook_:
   - Payload URL: the Worker URL
   - Content type: `application/json`
   - Secret: the value from step 2
   - Events: _Let me select individual events_ → **Issues** and
     **Projects v2 items**

GitHub sends a `ping` on creation; _Recent Deliveries_ shows the relay's
response for each event, and failed Discord posts can be redelivered from
there.

The status field name defaults to `Status`; change `STATUS_FIELD` in
`wrangler.toml` if the board uses another one.
