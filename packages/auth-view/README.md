# Shared authentication view

`@aiaiaiai/auth-view` contains the adaptive username/password form used at the
existing 0x1 entry point. It depends only on React. It contains no recovery-key,
bch recovery, avatar, Bond, Avaia, provider verification or session logic.

The selection starts from `DEFAULT_AUTH_SELECTION`: prefix `0x0`, empty slug.
The fixed `0x` and chosen hexadecimal digit form the prefix. The caller owns the
selection and resolves the exact, case-sensitive candidate. Available names
lead to explicit account creation; existing names lead to sign-in. Autofill
never authorizes creation. A remembered username remains a hint, not a session.

`AuthForm` accepts localized copy, resolved status, busy/error state and host
callbacks. `AuthView` adds neutral English/Ukrainian introductory content and a
product name. Import `@aiaiaiai/auth-view/styles.css` for its optional neutral
skin. Products may supply their own skin and translated copy.

| Host     | Presentation                                                      | Product-specific behavior                                            |
| -------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0x1      | Existing entry point, pub_dress labels, existing visual treatment | xPing, providers and post-auth body choice remain in the 0x1 adapter |
| Prism    | Neutral username/password content, product header                 | Product session adapter still required                               |
| h_ua_bot | Neutral username/password content, product header                 | Product session adapter still required                               |

Only 0x1 is wired to a live service by this change. The neutral view is reusable;
this is not cross-product SSO. A supplied product name changes presentation only,
never provider availability, authorization, redirect validation or session scope.
There is no invented shared Identity recovery mechanism.

The 0x1 adapter supplies its optional public-address extension. Other products
need not know that public naming system. The private stable Identity identifier
is not a view prop. Future shared Identity transport must keep it server-side.

## Registration contract 14

Native registration and verified-provider password setup return `authenticated`
with the existing secure session cookies. A new credential is active atomically
and has a NULL recovery verifier; no recovery key/challenge is generated. Session
issuance still uses the existing Single Active Client policy.

A repeated idempotency key returns a conflict without a session or identity
projection. The UI resolves again and offers sign-in; the password must be
verified by the session endpoint. Existing keys/challenges remain supported only
by the legacy 0x1 endpoints. Migration 0034 preserves them and all foreign keys. An unfinished legacy setup
can also complete through a verified password; a stale password proof cannot
activate a concurrently replaced credential, and the old challenge is consumed.
Older service versions that require non-null recovery verifiers cannot safely
read new credentials: roll back with a compatible service, not contract 13.

All web targets require Identity contract 14 before activation. No deployment
or external Prism/h_ua_bot integration is performed by this PR.
