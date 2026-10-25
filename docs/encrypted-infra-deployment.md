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

<!-- © 2026 aiaiaiai · aiaiaiai.org -->

# Market browser handoff credential

Store `NILX_BROWSER_HANDOFF_TOKEN` in this repository's Actions secrets (or
production Environment). Use the same random value, at least 32 characters,
in `0xda-market/core`. Identity includes it only in the age-encrypted runtime
envelope; it is never a client build variable. Deploy the companion infra
allowlist change before activating Identity. To apply a new or rotated token
without an image change, use the production workflow's force-identity option.
