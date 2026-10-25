# Producer-owned deployment secrets

`nilx-one/web` owns its provider credentials and uses
`aiaiaiai-org/infra` as a deployment executor. The producer no longer
copies those credentials to persistent infra repository Secrets.

Set the **non-secret** `INFRA_AGE_RECIPIENT` Variable in
`nilx-one/web → Settings → Environments → production` to the **public
SSH key** corresponding to `aiaiaiai-org/infra`'s `edge-prod-1`
`SSH_PRIVATE_KEY`. Infra provides an operator-only
**Show workload encryption recipient** workflow to display its public half.

The existing `nilx-one/web` `production` Secrets stay owned here:

- `TELOXIDE_TOKEN`
- `TELEGRAM_OIDC_CLIENT_SECRET`
- `DISCORD_CLIENT_SECRET`
- `INFRA_DEPLOY_TOKEN` (GitHub permission to request deployment)

The public `TELEGRAM_OIDC_CLIENT_ID` and `DISCORD_CLIENT_ID` Variables
also remain here. The manual `Deploy Production` workflow still performs
Identity first (when required), then client targets in order.

For Identity, the producer encrypts its three provider credentials and
short-lived `github.token` GHCR access with `age`. Infra decrypts using its
production SSH identity, checks a fixed allowlist, and provides credentials
only to the existing Identity runtime-preparation script. The provider
values are never written to the infra GitHub Secrets API.

For client images, only the short-lived GHCR access token is encrypted.
There are no runtime provider credentials in the client container.

The existing call to `repository_dispatch` remains; only its
`secrets_age` field is added. Infra's target, SSH access and activation
continue to be contract-driven. The caller still awaits the infra workflow
result; successful dispatch alone is not treated as deployment success.

**Migration:** merge and verify the new infra encrypted-handoff contract,
configure the `INFRA_AGE_RECIPIENT` public Variable, validate the deploy
workflow, then use an explicitly manual production deployment. Do not
delete old infra credentials until the first encrypted activation and
rollback have passed. No production deployment is automatic.
## Market browser handoff credential

Store `NILX_BROWSER_HANDOFF_TOKEN` in this repository's GitHub
`production` Environment (or repository Actions secrets). While Market runs
only in development, configure **the same random value, at least 32 bytes**
in `0xda-market/core`'s `development` Environment. The live `nilx.one`
Identity currently issues handoffs into that isolated development API; this
does not activate Market production. Rotate both values together.

Identity includes the token only in its age-encrypted runtime envelope,
never in client build variables. Merge the Infra allowlist change first.
To apply the token without an image change, run `Deploy Production` on
`master` with `target=identity`; this forces only the Identity runtime
redeployment, not the Web/Telegram/Discord clients.

<!-- © 2026 aiaiaiai · aiaiaiai.org -->
